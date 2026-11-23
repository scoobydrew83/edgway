/** The Kong-compatible mount: token auth (fail closed) and Kong's shapes. */
import { createExecutionContext, env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { HEADER, KONG_COMPAT, MEDIA_TYPE } from "@edgway/constants";
import { ERR, STATUS } from "@edgway/errors";
import { describe, expect, it } from "vitest";
import worker from "../src/index";
import { KONG_PUBLISH_PATH } from "../src/roles";

const TOKEN = "kong-viewer-token";
const EDITOR = "kong-editor-token";
const PUBLISHER = "kong-publisher-token";

const kong = (path: string, token?: string) =>
  exports.default.fetch(
    new Request(`https://admin.test${path}`, {
      headers: token ? { [HEADER.kongAdminToken]: token } : {},
    }),
  );

const write = (method: string, path: string, token: string, body?: unknown) =>
  exports.default.fetch(
    new Request(`https://admin.test${path}`, {
      method,
      headers: {
        [HEADER.kongAdminToken]: token,
        [HEADER.contentType]: MEDIA_TYPE.json,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );

/** Poll the gateway until `check` holds (it re-reads the pointer every second). */
async function eventually(check: () => Promise<boolean>) {
  for (let i = 0; i < 40; i++) {
    if (await check()) return true;
    await scheduler.wait(100);
  }
  return false;
}

describe("Kong-compatible mount", () => {
  it("answers decK's node info with a valid token", async () => {
    const res = await kong("/", TOKEN);
    expect(res.status).toBe(STATUS.ok);
    expect(await res.json()).toMatchObject({
      version: KONG_COMPAT.version,
      configuration: { database: KONG_COMPAT.database },
    });
    const services = await kong("/services", TOKEN);
    expect(await services.json()).toEqual({
      data: [],
      next: null,
      offset: null,
    });
  });

  it("never answers the native API's portal status", async () => {
    const created = await write("POST", "/consumers", EDITOR, {
      username: "kong-plain",
    });
    const { id } = await created.json<{ id: string }>();
    expect(await (await kong(`/consumers/${id}`, TOKEN)).text()).not.toContain(
      '"portal"',
    );
    expect(await (await kong("/consumers", TOKEN)).text()).not.toContain(
      '"portal"',
    );
  });

  it("masks secrets for viewer tokens, not for editors", async () => {
    const created = await write("POST", "/plugins", EDITOR, {
      name: "openid-connect",
      config: {
        issuer: "https://idp.example/",
        client_secret: ["kong-raw-secret"],
      },
    });
    expect(created.status).toBe(STATUS.created);
    const { id } = await created.json<{ id: string }>();
    const viewed = await (await kong(`/plugins/${id}`, TOKEN)).text();
    expect(viewed).not.toContain("kong-raw-secret");
    expect(await (await kong("/plugins", TOKEN)).text()).not.toContain(
      "kong-raw-secret",
    );
    expect(await (await kong(`/plugins/${id}`, EDITOR)).text()).toContain(
      "kong-raw-secret",
    );
    // Global: removed so later tests' published gateways don't run it.
    expect((await write("DELETE", `/plugins/${id}`, EDITOR)).status).toBe(
      STATUS.noContent,
    );
  });

  it("masks secrets for viewers on nested reads too", async () => {
    const service = await (
      await write("POST", "/services", EDITOR, {
        name: "nested-secrets",
        url: "https://nested.test",
      })
    ).json<{ id: string }>();
    const route = await (
      await write("POST", `/services/${service.id}/routes`, EDITOR, {
        name: "nested-secrets-route",
        paths: ["/nested-secrets"],
      })
    ).json<{ id: string }>();
    const created = await write("POST", `/routes/${route.id}/plugins`, EDITOR, {
      name: "openid-connect",
      config: {
        issuer: "https://idp.example/",
        client_secret: ["kong-nested-secret"],
      },
    });
    expect(created.status).toBe(STATUS.created);
    const { id } = await created.json<{ id: string }>();
    const nested = await kong(`/routes/${route.id}/plugins/${id}`, TOKEN);
    expect(nested.status).toBe(STATUS.ok);
    expect(await nested.text()).not.toContain("kong-nested-secret");
    expect(
      await (await kong(`/routes/${route.id}/plugins/${id}`, EDITOR)).text(),
    ).toContain("kong-nested-secret");
    // Global: removed so later tests' published gateways don't run them.
    for (const path of [`/plugins/${id}`, `/routes/${route.id}`]) {
      await write("DELETE", path, EDITOR);
    }
    await write("DELETE", `/services/${service.id}`, EDITOR);
  });

  it("refuses a basic-auth credential without a password", async () => {
    const consumer = await (
      await write("POST", "/consumers", EDITOR, { username: "no-password" })
    ).json<{ id: string }>();
    for (const body of [{ username: "np" }, { username: "np", password: "" }]) {
      const res = await write(
        "POST",
        `/consumers/${consumer.id}/basic-auth`,
        EDITOR,
        body,
      );
      expect(res.status).toBe(ERR.ADMIN_INVALID_REQUEST.status);
      expect(await res.json()).toHaveProperty("message");
    }
    const listed = await (
      await kong(`/consumers/${consumer.id}/basic-auth`, EDITOR)
    ).json<{ data: unknown[] }>();
    expect(listed.data).toEqual([]);
    await write("DELETE", `/consumers/${consumer.id}`, EDITOR);
  });

  it("refuses missing and unknown tokens in Kong's {message} shape", async () => {
    for (const token of [undefined, "not-a-token"]) {
      const res = await kong("/services", token);
      expect(res.status).toBe(ERR.ADMIN_UNAUTHENTICATED.status);
      expect(await res.json()).toHaveProperty("message");
    }
  });

  it("fails closed without, or with a malformed, token secret", async () => {
    for (const KONG_ADMIN_TOKENS of [undefined, "{not json", '{"x":"root"}']) {
      const res = await worker.fetch(
        new Request("https://admin.test/services", {
          headers: { [HEADER.kongAdminToken]: TOKEN },
        }),
        { ...env, KONG_ADMIN_TOKENS },
        createExecutionContext(),
      );
      expect(res.status).toBe(ERR.ADMIN_UNAUTHENTICATED.status);
    }
  });

  it("leaves the native API behind Access", async () => {
    const res = await kong("/api/v1/services", TOKEN);
    expect(res.status).toBe(ERR.ADMIN_UNAUTHENTICATED.status);
    // The native API answers in problem+json, not Kong's shape.
    expect(await res.json()).toHaveProperty(
      "code",
      ERR.ADMIN_UNAUTHENTICATED.code,
    );
  });

  it("needs the editor role to write, and answers Kong's shape", async () => {
    const denied = await write("PUT", "/consumers/kong-alice", TOKEN, {});
    expect(denied.status).toBe(ERR.ADMIN_ROLE_REQUIRED.status);
    expect(await denied.json()).toHaveProperty("message");
    const ok = await write("PUT", "/consumers/kong-alice", EDITOR, {});
    expect(ok.status).toBe(STATUS.ok);
    expect(await ok.json()).toMatchObject({ username: "kong-alice" });
    const unknown = await write("POST", "/plugins", EDITOR, {
      name: "rate-limiting-advanced",
    });
    expect(unknown.status).toBe(ERR.ADMIN_PLUGIN_NOT_ENABLED.status);
  });

  it("publishes for a publisher token, and the gateway serves the writes", async () => {
    const service = "0199a3c0-0000-7000-a000-00000000c0de";
    await write("PUT", `/services/${service}`, EDITOR, {
      name: "kong-synced",
      protocol: "https",
      host: "api.upstream.test",
      port: 443,
    });
    await write("PUT", "/routes/kong-synced", EDITOR, {
      paths: ["/kong-synced"],
      service: { id: service },
    });
    expect((await write("POST", KONG_PUBLISH_PATH, EDITOR)).status).toBe(
      ERR.ADMIN_ROLE_REQUIRED.status,
    );
    const published = await write("POST", KONG_PUBLISH_PATH, PUBLISHER);
    expect(published.status).toBe(STATUS.created);
    expect(await published.json()).toHaveProperty("version");
    expect(
      await eventually(async () => {
        const res = await env.GATEWAY.fetch(
          new Request("https://gw.test/kong-synced/x", {
            headers: { [HEADER.clientIp]: "203.0.113.9" },
          }),
        );
        return (
          res.status === STATUS.ok &&
          ((await res.json()) as { upstream?: boolean }).upstream === true
        );
      }),
    ).toBe(true);
  });
});

describe("schema validation", () => {
  it("lets any role validate, since it writes nothing", async () => {
    const res = await write("POST", "/schemas/services/validate", TOKEN, {
      name: "v",
      url: "https://v.example.test",
    });
    expect(res.status).toBe(STATUS.ok);
    expect(await res.json()).toEqual({ message: KONG_COMPAT.validation.ok });
    // A viewer still can't write.
    const created = await write("POST", "/services", TOKEN, { name: "v" });
    expect(created.status).toBe(ERR.ADMIN_ROLE_REQUIRED.status);
  });

  it("never lets a write through because its path ends in /validate", async () => {
    // Nested writes can end that way: a parent named "schemas", a child "validate".
    for (const [method, path] of [
      ["PUT", "/services/schemas/routes/validate"],
      ["PATCH", "/services/schemas/routes/validate"],
      ["DELETE", "/services/schemas/routes/validate"],
      ["DELETE", "/default/services/schemas/routes/validate"],
      ["DELETE", "/consumer_groups/schemas/consumers/validate"],
      ["PUT", "/schemas/services/validate"],
    ] as const) {
      const res = await write(method, path, TOKEN, { name: "validate" });
      expect(res.status, `${method} ${path}`).toBe(
        ERR.ADMIN_ROLE_REQUIRED.status,
      );
    }
    // The workspace-prefixed validate is open, as on `/`.
    const prefixed = await write(
      "POST",
      "/default/schemas/services/validate",
      TOKEN,
      { name: "v", url: "https://v.example.test" },
    );
    expect(prefixed.status).toBe(STATUS.ok);
  });
});
