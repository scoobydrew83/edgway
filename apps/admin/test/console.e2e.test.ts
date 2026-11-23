/**
 * the endpoints behind the admin UI's console pages. The route tester
 * runs end to end: the admin signs a trace token, the real gateway Worker
 * (auxiliary) verifies it and reports each plugin's decision.
 */
import { createExecutionContext, env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import {
  ADMIN_DIFF,
  ANALYTICS,
  CONFIG,
  HEADER,
  MEDIA_TYPE,
} from "@edgway/constants";
import { selectPlugins } from "@edgway/core";
import { ERR, STATUS } from "@edgway/errors";
import { importJWK, type JWK, SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import worker, { ConfigVersionReader } from "../src/index";
import { API_BASE } from "../src/roles";

const key = await importJWK(JSON.parse(env.TEST_ACCESS_KEY) as JWK, "RS256");

async function request(
  who: string,
  method: string,
  path: string,
  body?: unknown,
) {
  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({ email: who })
    .setProtectedHeader({ alg: "RS256", kid: "test" })
    .setIssuer(`https://${env.ACCESS_TEAM}.cloudflareaccess.com`)
    .setAudience(env.ACCESS_AUD)
    .setIssuedAt(now - 60)
    .setExpirationTime(now + 300)
    .sign(key);
  const headers: Record<string, string> = {
    [HEADER.cfAccessJwtAssertion]: token,
  };
  if (body !== undefined) headers[HEADER.contentType] = MEDIA_TYPE.json;
  return new Request(`https://admin.test${API_BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const admin = async (...args: Parameters<typeof request>) =>
  exports.default.fetch(await request(...args));

const VIEWER = "viewer@example.com";
const EDITOR = "editor@example.com";
const PUBLISHER = "publisher@example.com";

describe("plugin catalog", () => {
  it("lists Kong's plugins by category and serves their JSON Schemas", async () => {
    const catalog = await (await admin(VIEWER, "GET", "/plugin-catalog")).json<{
      data: { name: string; category: string }[];
    }>();
    expect(catalog.data).toContainEqual({
      name: "key-auth",
      category: "authentication",
    });
    expect(catalog.data).toContainEqual({
      name: "rate-limiting",
      category: "traffic-control",
    });
    const schema = await admin(VIEWER, "GET", "/plugin-schemas/key-auth");
    expect(schema.status).toBe(STATUS.ok);
    expect(JSON.stringify(await schema.json())).toContain("key_names");
    const unknown = await admin(VIEWER, "GET", "/plugin-schemas/nope");
    expect(unknown.status).toBe(ERR.ADMIN_NOT_FOUND.status);
  });
});

describe("snapshots", () => {
  it("returns the published and staged snapshots with secrets masked", async () => {
    await admin(EDITOR, "POST", "/consumers", { username: "snap" });
    const { key: apiKey } = await (
      await admin(EDITOR, "POST", "/consumers/snap/key-auth", {})
    ).json<{ key: string }>();
    const res = await admin(VIEWER, "GET", "/config/snapshots");
    expect(res.status).toBe(STATUS.ok);
    const text = await res.clone().text();
    expect(text).not.toContain(apiKey);
    const body = await res.json<{
      staged: Record<string, Record<string, unknown>[]>;
    }>();
    expect(body.staged.consumers).toContainEqual(
      expect.objectContaining({ username: "snap" }),
    );
    expect(body.staged.keyauth_credentials?.[0]?.key_hash).toBe(
      ADMIN_DIFF.redacted,
    );
  });
});

describe("route tester", () => {
  it("shows each plugin's decision from the real gateway", async () => {
    const service = await (
      await admin(EDITOR, "POST", "/services", {
        name: "tester",
        protocol: "https",
        host: "api.upstream.test",
        port: 443,
      })
    ).json<{ id: string }>();
    const route = await (
      await admin(EDITOR, "POST", "/routes", {
        name: "tester",
        service_id: service.id,
        paths: ["/tester"],
      })
    ).json<{ id: string }>();
    await admin(EDITOR, "POST", "/plugins", {
      name: "key-auth",
      route_id: route.id,
      config: {},
    });
    expect((await admin(PUBLISHER, "POST", "/config/publish", {})).status).toBe(
      STATUS.created,
    );

    const test = () =>
      admin(EDITOR, "POST", "/tester", { method: "GET", path: "/tester/x" });
    // The gateway re-reads the live version about once a second.
    let result: {
      status: number;
      body: string;
      trace: { plugin: string; phase: string; outcome: string }[];
    } = { status: 0, body: "", trace: [] };
    for (
      let i = 0;
      i < 40 && result.status !== ERR.AUTH_KEY_MISSING.status;
      i++
    ) {
      result = await (await test()).json();
      await scheduler.wait(100);
    }
    expect(result.status).toBe(ERR.AUTH_KEY_MISSING.status);
    expect(result.body).toContain(ERR.AUTH_KEY_MISSING.code);
    expect(result.trace).toContainEqual(
      expect.objectContaining({ plugin: "key-auth", phase: "access" }),
    );
    expect(result.trace.find((e) => e.plugin === "key-auth")?.outcome).not.toBe(
      "ok",
    );
  });

  it("sends the editor's own client IP, never one they typed", async () => {
    const service = await (
      await admin(EDITOR, "POST", "/services", {
        name: "tester-ip",
        host: "api.upstream.test",
      })
    ).json<{ id: string }>();
    const route = await (
      await admin(EDITOR, "POST", "/routes", {
        name: "tester-ip",
        service_id: service.id,
        paths: ["/ip-check"],
      })
    ).json<{ id: string }>();
    await admin(EDITOR, "POST", "/plugins", {
      name: "ip-restriction",
      route_id: route.id,
      config: { allow: ["198.51.100.1"] },
    });
    await admin(PUBLISHER, "POST", "/config/publish", {});
    const typed = {
      method: "GET",
      path: "/ip-check/x",
      headers: {
        "cf-connecting-ip": "198.51.100.1",
        "x-forwarded-for": "198.51.100.1",
      },
    };
    // Wait for the version with the route (the gateway re-reads it ~1/s).
    let status = 0;
    for (let i = 0; i < 40 && (status === 0 || status === 404); i++) {
      status = (
        await (
          await admin(EDITOR, "POST", "/tester", typed)
        ).json<{
          status: number;
        }>()
      ).status;
      await scheduler.wait(100);
    }
    // The allow-listed IP the editor typed is not theirs: refused.
    expect(status).toBe(ERR.IP_NOT_ALLOWED.status);
  });

  it("needs the editor role and a path on the gateway", async () => {
    const viewer = await admin(VIEWER, "POST", "/tester", { path: "/x" });
    expect(viewer.status).toBe(ERR.ADMIN_ROLE_REQUIRED.status);
    for (const path of ["//evil.example/x", "https://evil.example/", "x"]) {
      const res = await admin(EDITOR, "POST", "/tester", { path });
      expect(res.status).toBe(ERR.ADMIN_INVALID_REQUEST.status);
    }
  });

  it("never sends to another host, whatever the path's spelling", async () => {
    // URL parsing reads `\` as `/` and drops tabs: both resolve off-gateway.
    for (const path of ["/\\evil.example/x", "/\t/evil.example/x"]) {
      const res = await admin(EDITOR, "POST", "/tester", { path });
      expect(res.status).toBe(ERR.ADMIN_TESTER_BAD_REQUEST.status);
      expect(await res.json()).toMatchObject({
        code: ERR.ADMIN_TESTER_BAD_REQUEST.code,
      });
    }
  });

  it("rejects a body on GET and unknown methods as 400s", async () => {
    const get = await admin(EDITOR, "POST", "/tester", {
      method: "GET",
      path: "/x",
      body: "{}",
    });
    expect(await get.json()).toMatchObject({
      code: ERR.ADMIN_TESTER_BAD_REQUEST.code,
    });
    const odd = await admin(EDITOR, "POST", "/tester", {
      method: "BREW",
      path: "/x",
    });
    expect(odd.status).toBe(ERR.ADMIN_INVALID_REQUEST.status);
  });

  it("is a 503 without a gateway to call", async () => {
    const res = await worker.fetch(
      await request(EDITOR, "POST", "/tester", { path: "/x" }),
      { ...env, GATEWAY: undefined, GATEWAY_URL: "" },
      createExecutionContext(),
    );
    expect(res.status).toBe(ERR.ADMIN_TESTER_UNCONFIGURED.status);
  });

  it("never lets a direct request trace without the admin's signature", async () => {
    const res = await env.GATEWAY.fetch(
      new Request("https://gw.test/tester/x", {
        headers: { [HEADER.traceToken]: "not-a-token" },
      }),
    );
    expect(res.headers.has(HEADER.trace)).toBe(false);
  });
});

describe("analytics overview", () => {
  it("shows an empty state without an account and token", async () => {
    const res = await admin(VIEWER, "GET", "/analytics/overview");
    expect(await res.json()).toEqual({
      configured: false,
      hours: ANALYTICS.overviewHours,
      series: [],
      routes: [],
      latency: { p50_ms: null, p99_ms: null },
      consumers: [],
      config: expect.any(Object),
    });
  });

  it("covers 1, 24 or 168 hours, and refuses any other range", async () => {
    for (const hours of ANALYTICS.overviewRanges) {
      const res = await worker.fetch(
        await request(VIEWER, "GET", `/analytics/overview?hours=${hours}`),
        { ...env, CF_ACCOUNT_ID: "acc", AE_API_TOKEN: "tok" },
        createExecutionContext(),
      );
      expect(res.status).toBe(STATUS.ok);
      expect(await res.json()).toMatchObject({ configured: true, hours });
    }
    for (const bad of ["2", "0", "week", "-24"]) {
      const res = await admin(
        VIEWER,
        "GET",
        `/analytics/overview?hours=${bad}`,
      );
      expect(res.status).toBe(ERR.ADMIN_INVALID_REQUEST.status);
      expect(await res.json()).toMatchObject({
        code: ERR.ADMIN_INVALID_REQUEST.code,
      });
    }
  });

  it("reads Analytics Engine's SQL API with the token", async () => {
    const res = await worker.fetch(
      await request(VIEWER, "GET", "/analytics/overview"),
      { ...env, CF_ACCOUNT_ID: "acc", AE_API_TOKEN: "tok" },
      createExecutionContext(),
    );
    expect(res.status).toBe(STATUS.ok);
    expect(await res.json()).toEqual({
      configured: true,
      hours: ANALYTICS.overviewHours,
      series: [
        { hour: "2026-10-02 10:00:00", requests: 12, errors: 1, mean_ms: 4.5 },
      ],
      routes: [{ route: "r1", requests: 12, errors: 1 }],
      latency: { p50_ms: 3.25, p99_ms: 18 },
      consumers: [{ consumer: "c1", requests: 7, errors: 0 }],
      config: expect.any(Object),
    });
  });

  it("shows the live config version and the last publish", async () => {
    const publish = await admin(PUBLISHER, "POST", "/config/publish", {});
    expect(publish.ok).toBe(true);
    const { version } = (await publish.json()) as { version: number };
    const res = await admin(VIEWER, "GET", "/analytics/overview");
    const body = (await res.json()) as {
      config: {
        live: number | null;
        last_publish: { version: number; created_by: string } | null;
      };
    };
    expect(body.config.live).toBe(version);
    expect(body.config.last_publish).toMatchObject({ version });
    expect(body.config.last_publish?.created_by).toBeTruthy();
  });
});

describe("key separation", () => {
  it("turns the tester off without its own trace key", async () => {
    const res = await worker.fetch(
      await request(EDITOR, "POST", "/tester", { path: "/x" }),
      { ...env, TRACE_SIGNING_KEY: undefined },
      createExecutionContext(),
    );
    expect(res.status).toBe(ERR.ADMIN_DISABLED.status);
    expect(await res.json()).toMatchObject({
      code: ERR.ADMIN_DISABLED.code,
      detail: "TRACE_SIGNING_KEY",
    });
  });

  it("says publishing isn't configured without the signing key", async () => {
    const res = await worker.fetch(
      await request(PUBLISHER, "POST", "/config/publish", {}),
      { ...env, CONFIG_SIGNING_KEY: undefined },
      createExecutionContext(),
    );
    expect(res.status).toBe(ERR.ADMIN_PUBLISH_DISABLED.status);
    expect(await res.json()).toMatchObject({
      code: ERR.ADMIN_PUBLISH_DISABLED.code,
      detail: "CONFIG_SIGNING_KEY",
    });
  });

  it("gives the gateway a reader of the live version that can't move it", async () => {
    const versions = env.CONFIG_VERSION;
    if (!versions) throw new Error("the test admin binds CONFIG_VERSION");
    const live = await versions
      .get(versions.idFromName(CONFIG.versionObjectName))
      .current();
    const reader = new ConfigVersionReader(createExecutionContext(), env);
    expect(await reader.current()).toBe(live);
    // Only current(): the entrypoint has no way to move the live version.
    const methods = reader as unknown as Record<string, unknown>;
    for (const write of ["compareAndSet", "set", "allocate"]) {
      expect(methods[write]).toBeUndefined();
    }
  });
});

describe("which plugins run", () => {
  const post = async (path: string, body: unknown) => {
    const res = await admin(EDITOR, "POST", path, body);
    expect(res.status).toBe(STATUS.created);
    return (await res.json()) as { id: string };
  };
  const which = async (query: string) =>
    (
      (await (
        await admin(VIEWER, "GET", `/which-plugins?${query}`)
      ).json()) as {
        data: { id: string; name: string; runs: boolean; level: string[] }[];
      }
    ).data;

  it("answers as the gateway's selectPlugins does", async () => {
    const service = await post("/services", { name: "w-svc", host: "w.test" });
    const route = await post("/routes", {
      name: "w-route",
      paths: ["/w"],
      service_id: service.id,
    });
    const consumer = await post("/consumers", { username: "w-consumer" });
    const group = await post("/consumer_groups", { name: "w-group" });
    expect(
      (
        await admin(EDITOR, "POST", `/consumer_groups/${group.id}/consumers`, {
          consumer: { id: consumer.id },
        })
      ).status,
    ).toBe(STATUS.created);
    const limit = (scope: Record<string, string>) =>
      post("/plugins", {
        name: "rate-limiting",
        config: { minute: 10, policy: "local" },
        ...scope,
      });
    const onRoute = await limit({ route_id: route.id });
    const onConsumer = await limit({ consumer_id: consumer.id });
    const onGroup = await limit({ consumer_group_id: group.id });
    const cors = await post("/plugins", {
      name: "cors",
      service_id: service.id,
    });

    // The same instances, through @edgway/core's own selectPlugins.
    const instances = [
      { id: onRoute.id, scope: { route: route.id } },
      { id: onConsumer.id, scope: { consumer: consumer.id } },
      { id: onGroup.id, scope: { consumer_group: group.id } },
    ].map((p) => ({
      ...p,
      name: "rate-limiting",
      priority: 910,
      handlers: {},
    }));
    const expected = (request: Parameters<typeof selectPlugins>[1]) =>
      selectPlugins(instances, request).map((p) => p.id);

    // Consumer over route: the consumer's instance runs, the route's doesn't.
    const asConsumer = await which(`route=${route.id}&consumer=${consumer.id}`);
    const runs = (rows: typeof asConsumer) =>
      rows.filter((r) => r.runs && r.name === "rate-limiting").map((r) => r.id);
    expect(runs(asConsumer)).toEqual(
      expected({
        route: route.id,
        service: service.id,
        consumer: { id: consumer.id, consumerGroups: [group.id] },
      }),
    );
    expect(runs(asConsumer)).toEqual([onConsumer.id]);
    expect(
      asConsumer
        .filter((r) => !r.runs)
        .map((r) => r.id)
        .sort(),
    ).toEqual([onRoute.id, onGroup.id].sort());
    expect(asConsumer.find((r) => r.id === cors.id)).toMatchObject({
      runs: true,
      level: ["service"],
    });

    // A caller known by its group: the group's instance wins over the route.
    const asGroup = await which(`route=${route.id}&consumer_group=${group.id}`);
    expect(runs(asGroup)).toEqual(
      expected({
        route: route.id,
        service: service.id,
        consumer: { id: "", consumerGroups: [group.id] },
      }),
    );
    expect(runs(asGroup)).toEqual([onGroup.id]);
    expect(asGroup.find((r) => r.id === onRoute.id)).toMatchObject({
      runs: false,
      level: ["route"],
    });

    // No caller: only the route's instance applies.
    expect(runs(await which(`route=${route.id}`))).toEqual([onRoute.id]);
  });

  it("is a 404 for a route that doesn't exist", async () => {
    const res = await admin(
      VIEWER,
      "GET",
      "/which-plugins?route=no-such-route",
    );
    expect(res.status).toBe(ERR.ADMIN_NOT_FOUND.status);
  });
});
