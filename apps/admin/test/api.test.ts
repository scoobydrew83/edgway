import { createExecutionContext, env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { createAdminCore } from "@edgway/admin-core";
import { ADMIN, HEADER, MEDIA_TYPE, PUBLISH_WARNING } from "@edgway/constants";
import { ERR, STATUS } from "@edgway/errors";
import { importJWK, type JWK, SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import committed from "../openapi.json";
import worker from "../src/index";
import { API_BASE } from "../src/roles";

const BASE = `https://admin.test${API_BASE}`;
const key = await importJWK(JSON.parse(env.TEST_ACCESS_KEY) as JWK, "RS256");

/** An Access JWT, as Cloudflare Access signs one for this application. */
function accessToken(
  claims: Record<string, unknown>,
  options: { aud?: string; team?: string; expired?: boolean } = {},
) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: "test" })
    .setIssuer(
      `https://${options.team ?? env.ACCESS_TEAM}.cloudflareaccess.com`,
    )
    .setAudience(options.aud ?? env.ACCESS_AUD)
    .setIssuedAt(now - 60)
    .setExpirationTime(options.expired ? now - 3600 : now + 300)
    .sign(key);
}

async function call(
  who: string | Record<string, unknown> | undefined,
  method: string,
  path: string,
  body?: unknown,
) {
  const headers: Record<string, string> = {};
  if (who !== undefined) {
    headers[HEADER.cfAccessJwtAssertion] = await accessToken(
      typeof who === "string" ? { email: who } : who,
    );
  }
  if (body !== undefined) headers[HEADER.contentType] = MEDIA_TYPE.json;
  return exports.default.fetch(
    new Request(`${BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

const VIEWER = "viewer@example.com";
const EDITOR = "editor@example.com";

async function problem(res: Response, error: { status: number; code: string }) {
  expect(res.status).toBe(error.status);
  expect(await res.json()).toMatchObject({ code: error.code });
}

describe("Cloudflare Access", () => {
  it("rejects requests without an Access token", async () => {
    await problem(
      await call(undefined, "GET", "/services"),
      ERR.ADMIN_UNAUTHENTICATED,
    );
  });

  it("rejects tokens for another audience, another team, or expired", async () => {
    for (const options of [
      { aud: "someone-else" },
      { team: "other-team" },
      { expired: true },
    ]) {
      const res = await exports.default.fetch(
        new Request(`${BASE}/services`, {
          headers: {
            [HEADER.cfAccessJwtAssertion]: await accessToken(
              { email: EDITOR },
              options,
            ),
          },
        }),
      );
      await problem(res, ERR.ADMIN_UNAUTHENTICATED);
    }
  });

  it("fails closed without a valid Access team or AUD", async () => {
    for (const missing of [
      { ACCESS_AUD: "" },
      { ACCESS_TEAM: "" },
      // Not a valid Access team name: the verifier can't be built.
      { ACCESS_TEAM: "bad team!" },
    ]) {
      const request = new Request(`${BASE}/services`, {
        headers: {
          [HEADER.cfAccessJwtAssertion]: await accessToken({ email: EDITOR }),
        },
      });
      const res = await worker.fetch(
        request,
        { ...env, ...missing },
        createExecutionContext(),
      );
      await problem(res, ERR.ADMIN_UNAUTHENTICATED);
    }
  });

  it("fails closed on a malformed role map", async () => {
    for (const ADMIN_ROLES of [
      "{not json",
      JSON.stringify({ [EDITOR]: "root" }),
    ]) {
      const request = new Request(`${BASE}/services`, {
        headers: {
          [HEADER.cfAccessJwtAssertion]: await accessToken({ email: EDITOR }),
        },
      });
      const res = await worker.fetch(
        request,
        { ...env, ADMIN_ROLES },
        createExecutionContext(),
      );
      await problem(res, ERR.ADMIN_FORBIDDEN);
    }
  });

  it("forbids Access identities without an admin role, naming ADMIN_ROLES", async () => {
    const res = await call("stranger@example.com", "GET", "/services");
    expect(res.status).toBe(ERR.ADMIN_FORBIDDEN.status);
    expect(await res.json()).toMatchObject({
      code: ERR.ADMIN_FORBIDDEN.code,
      detail: "ADMIN_ROLES",
    });
  });

  it("GET /me names the identity and its role", async () => {
    for (const role of ["viewer", "editor", "publisher", "owner"]) {
      const res = await call(`${role}@example.com`, "GET", "/me");
      expect(res.status).toBe(STATUS.ok);
      expect(await res.json()).toEqual({
        id: `${role}@example.com`,
        email: `${role}@example.com`,
        role,
      });
    }
    // A service token: its client id, no email.
    const token = await call({ common_name: "ci-token.access" }, "GET", "/me");
    expect(await token.json()).toEqual({
      id: "ci-token.access",
      role: "editor",
    });
    // No identity, or one without a role.
    expect((await call(undefined, "GET", "/me")).status).toBe(
      ERR.ADMIN_UNAUTHENTICATED.status,
    );
    await problem(
      await call("stranger@example.com", "GET", "/me"),
      ERR.ADMIN_FORBIDDEN,
    );
  });

  it("accepts service tokens by client id", async () => {
    const res = await call(
      { common_name: "ci-token.access" },
      "GET",
      "/services",
    );
    expect(res.status).toBe(STATUS.ok);
  });
});

describe("roles", () => {
  it("lets viewers read but not write", async () => {
    expect((await call(VIEWER, "GET", "/services")).status).toBe(STATUS.ok);
    await problem(
      await call(VIEWER, "POST", "/services", { host: "a.test" }),
      ERR.ADMIN_ROLE_REQUIRED,
    );
    // Authorization comes before validation: no schema details for viewers.
    await problem(
      await call(VIEWER, "POST", "/services", { name: "no-host" }),
      ERR.ADMIN_ROLE_REQUIRED,
    );
  });

  it("hides secret values from viewers, not from editors", async () => {
    const created = await (
      await call(EDITOR, "POST", "/plugins", {
        name: "openid-connect",
        config: {
          issuer: "https://idp.example/",
          client_secret: ["raw-client-secret"],
          session_secret: "{vault://env/session}",
        },
      })
    ).json<{ id: string }>();
    const viewed = await (
      await call(VIEWER, "GET", `/plugins/${created.id}`)
    ).text();
    expect(viewed).not.toContain("raw-client-secret");
    expect(viewed).toContain("{vault://env/session}");
    const listed = await (await call(VIEWER, "GET", "/plugins")).text();
    expect(listed).not.toContain("raw-client-secret");
    const edited = await (
      await call(EDITOR, "GET", `/plugins/${created.id}`)
    ).text();
    expect(edited).toContain("raw-client-secret");
  });

  it("lets editors and owners write", async () => {
    for (const who of [EDITOR, "owner@example.com"]) {
      const res = await call(who, "POST", "/services", { host: "a.test" });
      expect(res.status).toBe(STATUS.created);
    }
  });
});

describe("entities over HTTP", () => {
  it("creates, reads, patches, replaces and deletes a service", async () => {
    const created = await call(EDITOR, "POST", "/services", {
      name: "httpbin",
      host: "httpbin.org",
      protocol: "https",
      port: 443,
      retries: 9,
    });
    expect(created.status).toBe(STATUS.created);
    const service = await created.json<Record<string, unknown>>();
    expect(service).not.toHaveProperty("workspace_id");

    const byName = await call(VIEWER, "GET", "/services/httpbin");
    expect(await byName.json()).toMatchObject({ id: service.id });

    const patched = await call(EDITOR, "PATCH", "/services/httpbin", {
      path: "/anything",
    });
    expect(await patched.json()).toMatchObject({
      path: "/anything",
      retries: 9,
    });

    const replaced = await call(EDITOR, "PUT", `/services/${service.id}`, {
      name: "httpbin",
      host: "httpbin.org",
    });
    expect(await replaced.json()).toMatchObject({ path: null, retries: 5 });

    const list = await call(VIEWER, "GET", "/services?size=1000");
    const ids = (await list.json<{ data: { id: string }[] }>()).data.map(
      (s) => s.id,
    );
    expect(ids).toContain(service.id);

    expect((await call(EDITOR, "DELETE", "/services/httpbin")).status).toBe(
      204,
    );
    await problem(
      await call(VIEWER, "GET", "/services/httpbin"),
      ERR.ADMIN_NOT_FOUND,
    );
  });

  it("validates bodies and query strings with the entity schemas", async () => {
    await problem(
      await call(EDITOR, "POST", "/services", { name: "no-host" }),
      ERR.ADMIN_INVALID_REQUEST,
    );
    await problem(
      await call(VIEWER, "GET", "/services?size=0"),
      ERR.ADMIN_INVALID_REQUEST,
    );
    // The workspace is the server's, never the client's (refused).
    await problem(
      await call(EDITOR, "POST", "/consumers", {
        username: "ws-probe",
        workspace_id: "0199a3c0-0000-7000-8000-00000000abcd",
      }),
      ERR.ADMIN_INVALID_REQUEST,
    );
  });

  it("refuses fields the entity doesn't take, naming them", async () => {
    const issues = async (res: Response) => {
      expect(res.status).toBe(ERR.ADMIN_INVALID_REQUEST.status);
      const body = await res.json<{
        code: string;
        issues: { path: string }[];
      }>();
      expect(body.code).toBe(ERR.ADMIN_INVALID_REQUEST.code);
      return body.issues.map((i) => i.path);
    };
    // Kong's shapes belong to the Kong mount, not the native API.
    expect(
      await issues(
        await call(EDITOR, "POST", "/services", {
          name: "unknown-url",
          url: "https://example.com",
        }),
      ),
    ).toContain("url");
    const created = await call(EDITOR, "POST", "/services", {
      name: "unknown-probe",
      host: "example.com",
    });
    expect(created.status).toBe(STATUS.created);
    const service = await created.json<Record<string, unknown>>();
    expect(
      await issues(
        await call(EDITOR, "POST", "/routes", {
          paths: ["/unknown-probe"],
          service: { id: service.id },
        }),
      ),
    ).toContain("service");
    expect(
      await issues(
        await call(EDITOR, "PATCH", "/services/unknown-probe", { hots: "x" }),
      ),
    ).toContain("hots");
    expect(
      await issues(
        await call(EDITOR, "PUT", "/services/unknown-probe", {
          host: "example.com",
          protocol_: "https",
        }),
      ),
    ).toContain("protocol_");
    // Internal fields are refused, not dropped.
    expect(
      await issues(
        await call(EDITOR, "POST", "/consumers", {
          username: "internal-probe",
          portal_subject: "someone",
        }),
      ),
    ).toContain("portal_subject");
    // Managed fields are the server's: refused too.
    expect(
      await issues(
        await call(EDITOR, "PATCH", "/services/unknown-probe", {
          created_at: 1,
        }),
      ),
    ).toContain("created_at");
  });

  it("filters lists by Kong's tags syntax", async () => {
    for (const [username, tags] of [
      ["t-a", ["red"]],
      ["t-b", ["red", "blue"]],
      ["t-c", ["blue"]],
    ] as const) {
      await call(EDITOR, "POST", "/consumers", { username, tags });
    }
    const names = async (tags: string) =>
      (
        await (
          await call(VIEWER, "GET", `/consumers?tags=${tags}`)
        ).json<{
          data: { username: string }[];
        }>()
      ).data.map((c) => c.username);
    expect(await names("red,blue")).toEqual(["t-b"]);
    expect(await names("red/blue")).toEqual(["t-a", "t-b", "t-c"]);
  });
});

describe("credentials", () => {
  it("returns a key-auth key once and never its hash", async () => {
    await call(EDITOR, "POST", "/consumers", { username: "kay" });
    const created = await call(EDITOR, "POST", "/consumers/kay/key-auth", {});
    expect(created.status).toBe(STATUS.created);
    const { credential, key } = await created.json<{
      credential: Record<string, unknown>;
      key: string;
    }>();
    expect(credential).not.toHaveProperty("key_hash");
    const listed = await (
      await call(VIEWER, "GET", "/consumers/kay/key-auth")
    ).text();
    expect(listed).not.toContain(key);
    expect(listed).not.toContain("key_hash");

    const rotated = await call(
      EDITOR,
      "POST",
      `/key-auth/${credential.id}/rotate`,
    );
    expect((await rotated.json<{ key: string }>()).key).not.toBe(key);
    expect(
      (await call(EDITOR, "DELETE", `/key-auth/${credential.id}`)).status,
    ).toBe(204);
  });

  it("never returns basic-auth passwords", async () => {
    await call(EDITOR, "POST", "/consumers", { username: "bea" });
    const created = await call(EDITOR, "POST", "/consumers/bea/basic-auth", {
      username: "bea",
      password: "pw",
    });
    expect(created.status).toBe(STATUS.created);
    expect(await created.json()).not.toHaveProperty("password");
  });

  it("manages consumer-group membership", async () => {
    const consumer = await (
      await call(EDITOR, "POST", "/consumers", { username: "gm" })
    ).json<{ id: string }>();
    await call(EDITOR, "POST", "/consumer_groups", { name: "gold" });
    const added = await call(
      EDITOR,
      "POST",
      "/consumer_groups/gold/consumers",
      {
        consumer: { id: consumer.id },
      },
    );
    expect(added.status).toBe(STATUS.created);
    const members = await call(
      VIEWER,
      "GET",
      "/consumer_groups/gold/consumers",
    );
    expect(await members.json()).toEqual({
      data: [{ consumer_id: consumer.id }],
    });
    expect(
      (
        await call(
          EDITOR,
          "DELETE",
          `/consumer_groups/gold/consumers/${consumer.id}`,
        )
      ).status,
    ).toBe(204);
  });
});

describe("hand-written bodies refuse unknown fields", () => {
  const PUBLISHER = "publisher@example.com";
  const unknown = async (res: Response, field: string) => {
    expect(res.status).toBe(ERR.ADMIN_INVALID_REQUEST.status);
    const body = await res.json<{ code: string; issues: { path: string }[] }>();
    expect(body.code).toBe(ERR.ADMIN_INVALID_REQUEST.code);
    expect(body.issues.map((i) => i.path)).toContain(field);
  };

  it("key-auth, basic-auth and membership bodies", async () => {
    const consumer = await (
      await call(EDITOR, "POST", "/consumers", { username: "strict-bodies" })
    ).json<{ id: string }>();
    await unknown(
      await call(EDITOR, "POST", "/consumers/strict-bodies/key-auth", {
        expires: 60,
      }),
      "expires",
    );
    await unknown(
      await call(EDITOR, "POST", "/consumers/strict-bodies/basic-auth", {
        username: "sb",
        password: "pw",
        pass: "pw",
      }),
      "pass",
    );
    const basic = await (
      await call(EDITOR, "POST", "/consumers/strict-bodies/basic-auth", {
        username: "sb",
        password: "pw",
      })
    ).json<{ id: string }>();
    await unknown(
      await call(EDITOR, "PATCH", `/basic-auth/${basic.id}`, { user: "x" }),
      "user",
    );
    await call(EDITOR, "POST", "/consumer_groups", { name: "strict" });
    await unknown(
      await call(EDITOR, "POST", "/consumer_groups/strict/consumers", {
        consumer: { id: consumer.id, username: "strict-bodies" },
      }),
      "consumer.username",
    );
  });

  it("publish and rollback bodies, publishing nothing", async () => {
    const versions = async () =>
      (
        await (
          await call(PUBLISHER, "GET", "/config/versions")
        ).json<{
          data: unknown[];
        }>()
      ).data.length;
    const before = await versions();
    await unknown(
      await call(PUBLISHER, "POST", "/config/publish", { message: "x" }),
      "message",
    );
    await unknown(
      await call(PUBLISHER, "POST", "/config/rollback", {
        version: 1,
        dryRun: true,
      }),
      "dryRun",
    );
    expect(await versions()).toBe(before);
  });
});

describe("audit and documentation", () => {
  it("records the Access identity as the actor", async () => {
    await call(EDITOR, "POST", "/consumers", { username: "audited" });
    const events = await (await call(VIEWER, "GET", "/audit-events")).json<{
      data: { actor: string; entity_type: string }[];
    }>();
    expect(events.data[0]).toMatchObject({
      actor: EDITOR,
      entity_type: "consumers",
    });
  });

  it("serves the OpenAPI document and the Scalar reference", async () => {
    const doc = await call(VIEWER, "GET", "/openapi.json");
    expect(doc.status).toBe(STATUS.ok);
    const spec = await doc.json<{
      openapi: string;
      paths: Record<string, Record<string, unknown>>;
    }>();
    expect(spec.openapi).toBe("3.1.0");
    // The committed document the SDK is generated from must match (run
    // `pnpm --filter @edgway/admin openapi` after changing the API).
    expect(spec).toEqual(committed);
    for (const path of [
      "/services",
      "/services/{id}",
      "/routes",
      "/plugins",
      "/consumers/{id}/key-auth",
      "/key-auth/{id}/rotate",
    ]) {
      expect(spec.paths).toHaveProperty([path]);
    }
    expect(Object.keys(spec.paths["/services/{id}"] ?? {}).sort()).toEqual([
      "delete",
      "get",
      "patch",
      "put",
    ]);
    const docs = await call(VIEWER, "GET", "/docs");
    expect(docs.status).toBe(STATUS.ok);
    expect(docs.headers.get(HEADER.contentType)).toContain("text/html");
    // Documentation is behind Access too.
    await problem(
      await call(undefined, "GET", "/openapi.json"),
      ERR.ADMIN_UNAUTHENTICATED,
    );
  });
});

describe("pending warnings", () => {
  it("lists a raw plugin secret only when asked", async () => {
    await call(EDITOR, "POST", "/plugins", {
      name: "openid-connect",
      config: {
        issuer: "https://idp.example/",
        client_secret: ["raw-pending-secret"],
      },
    });
    const plain = await (await call(VIEWER, "GET", "/config/pending")).json<
      Record<string, unknown>
    >();
    expect(plain).not.toHaveProperty("warnings");
    const asked = await (
      await call(VIEWER, "GET", "/config/pending?warnings=true")
    ).json<{ warnings: { code: string; name: string; fields: string[] }[] }>();
    expect(asked.warnings).toContainEqual(
      expect.objectContaining({
        code: PUBLISH_WARNING.rawSecret,
        name: "openid-connect",
        fields: expect.arrayContaining(["client_secret.[]"]),
      }),
    );
    // Never the value itself.
    expect(JSON.stringify(asked.warnings)).not.toContain("raw-pending-secret");
  });
});

describe("CSRF", () => {
  const PUBLISHER = "publisher@example.com";
  /** A publish sent the way a form or a cross-site page would send it. */
  async function publish(headers: Record<string, string>) {
    return exports.default.fetch(
      new Request(`${BASE}/config/publish`, {
        method: "POST",
        headers: {
          [HEADER.cfAccessJwtAssertion]: await accessToken({
            email: PUBLISHER,
          }),
          [HEADER.contentType]: "text/plain",
          ...headers,
        },
        body: "{}",
      }),
    );
  }
  const versions = async () =>
    (
      await (
        await call(PUBLISHER, "GET", "/config/versions")
      ).json<{
        data: unknown[];
      }>()
    ).data.length;

  it("refuses a cross-origin text/plain publish and publishes nothing", async () => {
    const before = await versions();
    await problem(
      await publish({ [HEADER.origin]: "https://evil.example" }),
      ERR.ADMIN_FORBIDDEN,
    );
    await problem(
      await publish({ [HEADER.secFetchSite]: "cross-site" }),
      ERR.ADMIN_FORBIDDEN,
    );
    expect(await versions()).toBe(before);
  });

  it("lets the admin's own origin through", async () => {
    const res = await publish({ [HEADER.origin]: "https://admin.test" });
    expect(res.status).not.toBe(ERR.ADMIN_FORBIDDEN.status);
  });

  it("lets non-browser clients through (no Origin, no Sec-Fetch-Site)", async () => {
    const res = await publish({});
    expect(res.status).not.toBe(ERR.ADMIN_FORBIDDEN.status);
  });
});

describe("native API paths and portal access", () => {
  it("answers 404 to an unknown path under the native API", async () => {
    await problem(
      await call(EDITOR, "GET", "/no-such-collection"),
      ERR.ADMIN_NOT_FOUND,
    );
  });

  it("blocks and unblocks a portal developer, removing their keys", async () => {
    // A developer's first portal sign-in, then a key.
    const core = createAdminCore(env.DB, {
      workspaceId: ADMIN.defaultWorkspaceId,
      actor: "oidc:dev-to-block",
    });
    const { consumer } = await core.portal.signIn("dev-to-block");
    const id = String(consumer.id);
    await core.keyAuth.create({ consumer_id: id });
    await core.keyAuth.create({ consumer_id: id });

    await problem(
      await call(VIEWER, "POST", `/consumers/${id}/portal-block`),
      ERR.ADMIN_ROLE_REQUIRED,
    );
    const blocked = await call(EDITOR, "POST", `/consumers/${id}/portal-block`);
    expect(blocked.status).toBe(STATUS.ok);
    expect(await blocked.json()).toEqual({ blocked: true, keys_removed: 2 });
    expect(
      (await core.keyAuth.list({ where: { consumer_id: id } })).data,
    ).toEqual([]);
    // Signing in again finds the same, blocked consumer.
    const again = await core.portal.signIn("dev-to-block");
    expect(again).toMatchObject({ blocked: true, consumer: { id } });
    // The flag is internal: never in a consumer read (which answers: an
    // entity without a `name` column is found by id).
    const read = await call(EDITOR, "GET", `/consumers/${id}`);
    expect(read.status).toBe(STATUS.ok);
    const text = await read.text();
    expect(text).not.toContain("portal_blocked");
    // Its portal status is read-only, without the subject.
    expect(text).not.toContain("dev-to-block");
    expect(JSON.parse(text).portal).toEqual({ developer: true, blocked: true });
    const listed = await (
      await call(EDITOR, "GET", "/consumers?size=1000")
    ).json<{ data: { id: string; portal?: unknown }[] }>();
    expect(listed.data.find((c) => c.id === id)?.portal).toEqual({
      developer: true,
      blocked: true,
    });

    const unblocked = await call(
      EDITOR,
      "DELETE",
      `/consumers/${id}/portal-block`,
    );
    expect(await unblocked.json()).toEqual({ blocked: false, keys_removed: 0 });
    expect((await core.portal.signIn("dev-to-block")).blocked).toBe(false);
    const reread = await (await call(EDITOR, "GET", `/consumers/${id}`)).json<{
      portal: unknown;
    }>();
    expect(reread.portal).toEqual({ developer: true, blocked: false });
  });

  it("refuses to block a consumer that isn't a portal developer", async () => {
    const consumer = await (
      await call(EDITOR, "POST", "/consumers", { username: "not-a-developer" })
    ).json<{ id: string }>();
    await problem(
      await call(EDITOR, "POST", `/consumers/${consumer.id}/portal-block`),
      ERR.ADMIN_INVALID_REQUEST,
    );
    const read = await (
      await call(EDITOR, "GET", `/consumers/${consumer.id}`)
    ).json<{ portal: unknown }>();
    expect(read.portal).toEqual({ developer: false, blocked: false });
  });
});

describe("audit events name their entity", () => {
  it("answers each event's entity name", async () => {
    const created = await (
      await call(EDITOR, "POST", "/services", {
        name: "audit-named-svc",
        host: "audit-named.test",
      })
    ).json<{ id: string }>();
    const page = await (await call(EDITOR, "GET", "/audit-events")).json<{
      data: { entity_id: string | null; entity_name?: string }[];
    }>();
    expect(page.data.find((e) => e.entity_id === created.id)).toMatchObject({
      entity_name: "audit-named-svc",
    });
  });

  it("names what a plugin is on, a deleted one from its diff, a credential by its consumer", async () => {
    const post = async (path: string, body: object) =>
      (await call(EDITOR, "POST", path, body)).json<{ id: string }>();
    const service = await post("/services", {
      name: "audit-scope-svc",
      host: "audit-scope.test",
    });
    const route = await post("/routes", {
      name: "audit-scope-route",
      paths: ["/audit-scope"],
      service_id: service.id,
    });
    const plugin = await post("/plugins", {
      name: "rate-limiting",
      route_id: route.id,
      config: { minute: 5 },
    });
    expect((await call(EDITOR, "DELETE", `/plugins/${plugin.id}`)).status).toBe(
      STATUS.noContent,
    );
    const consumer = await post("/consumers", { username: "audit-scope-user" });
    const key = await (
      await call(EDITOR, "POST", `/consumers/${consumer.id}/key-auth`, {})
    ).json<{ credential: { id: string } }>();
    const certificate = await post("/certificates", {
      cert: "-----BEGIN CERTIFICATE-----",
      key: "{vault://env/audit-scope-key}",
    });

    type Event = {
      action: string;
      entity_id: string | null;
      entity_name?: string;
      scope?: { type: string; name: string };
    };
    const { data } = await (
      await call(EDITOR, "GET", "/audit-events?size=100")
    ).json<{ data: Event[] }>();
    const of = (id: string, action = "create") =>
      data.find((e) => e.entity_id === id && e.action === action);
    expect(of(plugin.id)).toMatchObject({
      entity_name: "rate-limiting",
      scope: { type: "routes", name: "audit-scope-route" },
    });
    // Deleted: still named, from the event's own diff.
    expect(of(plugin.id, "delete")).toMatchObject({
      entity_name: "rate-limiting",
      scope: { type: "routes", name: "audit-scope-route" },
    });
    // A credential is named by its consumer.
    expect(of(key.credential.id)?.scope).toEqual({
      type: "consumers",
      name: "audit-scope-user",
    });
    // A certificate isn't named by its private key's reference.
    expect(of(certificate.id)).toBeDefined();
    expect(of(certificate.id)?.entity_name).toBeUndefined();
  });
});

describe("admin UI security headers", () => {
  it("serves the UI and its files with the CSP, nosniff and a referrer policy", async () => {
    const asked: string[] = [];
    const ASSETS = {
      fetch: async (input: RequestInfo | URL) => {
        asked.push(
          new URL(input instanceof Request ? input.url : input).pathname,
        );
        return new Response("<!doctype html>", {
          headers: { "content-type": "text/html" },
        });
      },
    } as unknown as Fetcher;
    // The bare /ui redirects, with the headers too.
    const bare = await worker.fetch(
      new Request("https://admin.test/ui"),
      { ...env, ASSETS },
      createExecutionContext(),
    );
    expect(bare.headers.get("x-frame-options")).toBe("DENY");
    for (const path of ["/ui/consumers", "/ui/assets/app.js"]) {
      const res = await worker.fetch(
        new Request(`https://admin.test${path}`),
        { ...env, ASSETS },
        createExecutionContext(),
      );
      expect(res.status).toBe(STATUS.ok);
      const csp = res.headers.get("content-security-policy") ?? "";
      expect(csp).toContain("frame-ancestors 'none'");
      // Scripts from this origin only: never inline ones.
      const scripts = csp
        .split(";")
        .find((d) => d.trim().startsWith("script-src"));
      expect(scripts?.trim()).toBe("script-src 'self' 'unsafe-eval'");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("referrer-policy")).toBe(
        "strict-origin-when-cross-origin",
      );
      expect(res.headers.get("x-frame-options")).toBe("DENY");
    }
    // A client route gets the SPA's page; a file is asked for by its path.
    expect(asked).toEqual(["/ui/", "/ui/assets/app.js"]);
  });
});
