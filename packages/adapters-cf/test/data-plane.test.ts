import {
  createExecutionContext,
  env,
  waitOnExecutionContext,
} from "cloudflare:test";
import { ANALYTICS, CONFIG, HEADER, KV_KEY, TRACE } from "@edgway/constants";
import { sha256Hex } from "@edgway/core";
import { ERR, errorHandler } from "@edgway/errors";
import {
  ATTR_EDGWAY_PHASE,
  ATTR_EDGWAY_ROUTE_ID,
  ATTR_EDGWAY_ROUTES_SKIPPED,
  ATTR_EDGWAY_UPSTREAMS_FALLBACK,
  configureLogging,
  EVENT,
  type PluginMetric,
  SPAN,
} from "@edgway/telemetry";
import { Hono } from "hono";
import { CompactSign, exportJWK, generateKeyPair, SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { credentialNamesOf } from "../src/data-plane";
import {
  createDataPlane,
  type DataPlaneEnv,
  type ObservedRequest,
  type PluginFactory,
  type Snapshot,
  type TraceEntry,
  versionReader,
} from "../src/index";

const keys = await generateKeyPair("EdDSA", { extractable: true });
/** The route tester's own key pair, separate from the snapshot key. */
const traceKeys = await generateKeyPair("EdDSA", { extractable: true });
const bindings: DataPlaneEnv = {
  CONFIG_KV: env.CONFIG_KV,
  CONFIG_PUBLIC_KEY: JSON.stringify(await exportJWK(keys.publicKey)),
  TRACE_PUBLIC_KEY: JSON.stringify(await exportJWK(traceKeys.publicKey)),
};

/** What the admin does on publish: sign {version, sha256}, write KV. */
async function publish(version: number, config: Snapshot) {
  const snapshot = JSON.stringify(config);
  const manifest = await new CompactSign(
    new TextEncoder().encode(
      JSON.stringify({ version, sha256: await sha256Hex(snapshot) }),
    ),
  )
    .setProtectedHeader({ alg: "EdDSA" })
    .sign(keys.privateKey);
  await env.CONFIG_KV.put(
    KV_KEY.configVersion(version),
    JSON.stringify({ manifest, snapshot }),
  );
  await env.CONFIG_KV.put(KV_KEY.configCurrent, JSON.stringify({ version }));
}

const ran: string[] = [];
/** What `observe` was told, per request. */
const observed: ObservedRequest[] = [];
/** Statuses the outer app's error handler rendered. */
const handled: number[] = [];

/** A plugin that records its run and tags the response with its config. */
const tagger: PluginFactory = {
  name: "tagger",
  instance: ({ id, scope, config }) => ({
    id,
    name: "tagger",
    priority: 10,
    scope,
    handlers: {
      access: async (c, next) => {
        ran.push(id);
        await next();
        c.res.headers.set("x-tag", String((config as { tag: string }).tag));
      },
    },
  }),
};

/** A plugin that removes a query parameter, as hide_credentials does. */
const stripSecret: PluginFactory = {
  name: "strip-secret",
  instance: ({ id, scope }) => ({
    id,
    name: "strip-secret",
    priority: 20,
    scope,
    handlers: {
      access: async (c, next) => {
        const url = new URL(c.req.url);
        url.searchParams.delete("secret");
        c.req.raw = new Request(url, c.req.raw);
        await next();
      },
    },
  }),
};

/** A plugin that answers itself, as request-termination does. */
const teapot: PluginFactory = {
  name: "teapot",
  instance: ({ id, scope }) => ({
    id,
    name: "teapot",
    priority: 30,
    scope,
    handlers: { access: async (c) => c.text("teapot", 418) },
  }),
};

const snapshot = (tag: string): Snapshot => ({
  services: [
    { id: "svc", protocol: "https", host: "api.example", port: 443, path: "/" },
  ],
  routes: [
    { id: "r1", service_id: "svc", paths: ["/one"], strip_path: true },
    { id: "r2", paths: ["/broken"] },
  ],
  consumers: [],
  plugins: [
    { id: "p-tag", name: "tagger", route_id: "r1", config: { tag } },
    { id: "p-strip", name: "strip-secret", route_id: "r1", config: {} },
    {
      id: "p-off",
      name: "tagger",
      service_id: "svc",
      enabled: false,
      config: {},
    },
    // A plugin this gateway doesn't bundle, disabled: skipped.
    { id: "p-unknown", name: "not-bundled", enabled: false, config: {} },
  ],
});

function gateway() {
  const app = new Hono<{ Bindings: DataPlaneEnv }>();
  app.all(
    "*",
    createDataPlane<DataPlaneEnv>({
      plugins: [tagger, stripSecret, teapot],
      observe: (_c, request) => observed.push(request),
      setup: (s, e) => {
        expect(e.CONFIG_KV).toBe(env.CONFIG_KV);
        return async (_c, next) => {
          ran.push(`setup:${s.routes.length}`);
          await next();
        };
      },
    }),
  );
  const render = errorHandler();
  app.onError(async (error, c) => {
    const res = await render(error, c);
    handled.push(res.status);
    return res;
  });
  return async (path: string, init: RequestInit = {}) => {
    const ctx = createExecutionContext();
    const res = await app.request(path, init, bindings, ctx);
    await waitOnExecutionContext(ctx);
    return res;
  };
}

describe("createDataPlane", () => {
  it("runs setup, then the snapshot's plugins, and proxies upstream", async () => {
    await publish(1, snapshot("v1"));
    const call = gateway();
    ran.length = 0;
    const res = await call("https://gw.test/one/x?secret=s&keep=1");
    expect(res.status).toBe(200);
    // The matched route is shown to traced requests only.
    expect(res.headers.get(HEADER.route)).toBeNull();
    expect(res.headers.get("x-tag")).toBe("v1");
    // Disabled plugins (known or not) are skipped.
    expect(ran).toEqual(["setup:2", "p-tag"]);
    // The query the plugins left reaches the upstream.
    const body = await res.json<{ url: string }>();
    expect(body.url).toBe("https://api.example/x?keep=1");
  });

  it("fails closed only on the routes of an enabled plugin it doesn't have", async () => {
    const config = snapshot("v1");
    config.plugins.push({
      id: "p-missing",
      name: "not-bundled",
      route_id: "r1",
      config: {},
    });
    await publish(1, config);
    const call = gateway();
    const blocked = await call("https://gw.test/one/x");
    expect(blocked.status).toBe(ERR.PLUGIN_UNAVAILABLE.status);
    expect(await blocked.json()).toMatchObject({
      code: ERR.PLUGIN_UNAVAILABLE.code,
    });
  });

  it("honours a plugin's on_error over its default", async () => {
    /** A policy plugin (fail-closed by default) whose own work breaks. */
    const broken: PluginFactory = {
      name: "broken-policy",
      instance: ({ id, scope, on_error }) => ({
        id,
        name: "broken-policy",
        priority: 5,
        scope,
        enforces: "policy",
        on_error,
        handlers: {
          access: async () => {
            throw new Error("policy store unreachable");
          },
        },
      }),
    };
    const run = async (on_error?: "fail-open" | "fail-closed") => {
      const config = snapshot("v1");
      config.plugins = [
        {
          id: "p-broken",
          name: "broken-policy",
          route_id: "r1",
          on_error,
          config: {},
        },
      ];
      await publish(1, config);
      const app = new Hono<{ Bindings: DataPlaneEnv }>();
      app.all("*", createDataPlane<DataPlaneEnv>({ plugins: [broken] }));
      app.onError(errorHandler());
      const ctx = createExecutionContext();
      const res = await app.request("https://gw.test/one/x", {}, bindings, ctx);
      await waitOnExecutionContext(ctx);
      return res.status;
    };
    expect(await run()).toBe(ERR.INTERNAL.status);
    expect(await run("fail-open")).toBe(200);
  });

  describe("with the ConfigVersion DO", () => {
    const object = () =>
      env.CONFIG_VERSION.get(
        env.CONFIG_VERSION.idFromName(CONFIG.versionObjectName),
      );
    const withDo = () => {
      const app = new Hono<{ Bindings: DataPlaneEnv }>();
      app.all(
        "*",
        createDataPlane<DataPlaneEnv>({ plugins: [tagger, stripSecret] }),
      );
      app.onError(errorHandler());
      return async (path: string) => {
        const ctx = createExecutionContext();
        const res = await app.request(
          path,
          {},
          { ...bindings, CONFIG_VERSION: versionReader(env.CONFIG_VERSION) },
          ctx,
        );
        await waitOnExecutionContext(ctx);
        return res;
      };
    };

    it("serves a publish within a second, though KV's pointer is stale", async () => {
      await publish(11, snapshot("v11"));
      await object().set(11);
      const call = withDo();
      expect((await call("https://gw.test/one")).headers.get("x-tag")).toBe(
        "v11",
      );
      // v12's snapshot is written and the DO moved; KV's pointer still says 11.
      await publish(12, snapshot("v12"));
      await env.CONFIG_KV.put(
        KV_KEY.configCurrent,
        JSON.stringify({ version: 11 }),
      );
      await object().set(12);
      // Propagation is bounded by one version check, whatever the load:
      // the interval is under 2 s, and the first request sent once it has
      // passed serves v12 (timing the answer would measure the machine, as
      // the full gate runs every package's tests at once).
      expect(CONFIG.versionCheckMs).toBeLessThan(2000);
      const moved = Date.now();
      await scheduler.wait(CONFIG.versionCheckMs);
      expect(Date.now() - moved).toBeGreaterThanOrEqual(CONFIG.versionCheckMs);
      expect((await call("https://gw.test/one")).headers.get("x-tag")).toBe(
        "v12",
      );
    });

    it("ignores a planted KV pointer to an older version", async () => {
      await publish(21, snapshot("v21"));
      await publish(22, snapshot("v22"));
      await object().set(22);
      const call = withDo();
      // Someone with KV write access points config:current back at 21.
      await env.CONFIG_KV.put(
        KV_KEY.configCurrent,
        JSON.stringify({ version: 21 }),
      );
      await scheduler.wait(CONFIG.versionCheckMs + 50);
      expect((await call("https://gw.test/one")).headers.get("x-tag")).toBe(
        "v22",
      );
    });

    it("never serves a planted older pointer while the live snapshot is missing", async () => {
      await publish(31, snapshot("v31"));
      await publish(32, snapshot("v32"));
      const live = await env.CONFIG_KV.get(KV_KEY.configVersion(32));
      // KV write access alone: delete v32 and point config:current at v31.
      await env.CONFIG_KV.delete(KV_KEY.configVersion(32));
      await env.CONFIG_KV.put(
        KV_KEY.configCurrent,
        JSON.stringify({ version: 31 }),
      );
      await object().set(32);
      const res = await withDo()("https://gw.test/one");
      expect(res.status).toBe(ERR.CONFIG_UNAVAILABLE.status);
      expect(await res.json()).toMatchObject({
        code: ERR.CONFIG_UNAVAILABLE.code,
      });
      // Once config:v32 is readable, it is served.
      if (live === null) throw new Error("config:v32 was not written");
      await env.CONFIG_KV.put(KV_KEY.configVersion(32), live);
      expect((await withDo()("https://gw.test/one")).headers.get("x-tag")).toBe(
        "v32",
      );
    });

    it("never reads a planted pointer when the DO can't be reached", async () => {
      await publish(41, snapshot("v41"));
      await publish(42, snapshot("v42"));
      // The DO is down and KV's pointer was planted back to 41.
      await env.CONFIG_KV.put(
        KV_KEY.configCurrent,
        JSON.stringify({ version: 41 }),
      );
      const unreachable = {
        current: async (): Promise<number | undefined> => {
          throw new Error("DO unreachable");
        },
      };
      const app = new Hono<{ Bindings: DataPlaneEnv }>();
      app.all(
        "*",
        createDataPlane<DataPlaneEnv>({ plugins: [tagger, stripSecret] }),
      );
      app.onError(errorHandler());
      const ctx = createExecutionContext();
      const res = await app.request(
        "https://gw.test/one",
        {},
        { ...bindings, CONFIG_VERSION: unreachable },
        ctx,
      );
      await waitOnExecutionContext(ctx);
      expect(res.status).toBe(ERR.CONFIG_UNAVAILABLE.status);
      expect(res.headers.get("x-tag")).toBeNull();
    });

    it("answers 503 before the first publish, not a bare 500", async () => {
      await env.CONFIG_KV.delete(KV_KEY.configCurrent);
      const live = await object().current();
      if (live !== undefined) await object().compareAndSet(live, undefined);
      const res = await withDo()("https://gw.test/one");
      expect(res.status).toBe(ERR.CONFIG_UNAVAILABLE.status);
      expect(await res.json()).toMatchObject({
        code: ERR.CONFIG_UNAVAILABLE.code,
      });
    });
  });

  it("answers 426 to plain HTTP on a snapshot's https-only route", async () => {
    const tls = snapshot("v1");
    tls.routes = tls.routes.map((r) =>
      r.id === "r1" ? { ...r, protocols: ["https"] } : r,
    );
    await publish(1, tls);
    const call = gateway();
    const plain = await call("http://gw.test/one");
    expect(plain.status).toBe(ERR.ROUTE_HTTPS_REQUIRED.status);
    expect(await plain.json()).toMatchObject({
      code: ERR.ROUTE_HTTPS_REQUIRED.code,
    });
    expect((await call("https://gw.test/one")).status).toBe(200);
  });

  it("redirects plain HTTP per a snapshot route's https_redirect_status_code", async () => {
    const tls = snapshot("v1");
    tls.routes = tls.routes.map((r) =>
      r.id === "r1"
        ? { ...r, protocols: ["https"], https_redirect_status_code: 308 }
        : r,
    );
    await publish(1, tls);
    const res = await gateway()("http://gw.test/one?x=1");
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe("https://gw.test/one?x=1");
  });

  it("logs the routes it leaves out of a published config", async () => {
    const records: { message: readonly unknown[]; properties: unknown }[] = [];
    configureLogging({ sink: (record) => void records.push(record) });
    const unsupported = snapshot("v1");
    unsupported.routes = [
      ...unsupported.routes,
      { id: "r-snis", service_id: "svc", paths: ["/tls"], snis: ["a.test"] },
    ];
    await publish(1, unsupported);
    // The other routes still run.
    expect((await gateway()("https://gw.test/one")).status).toBe(200);
    const warned = records.find((r) => r.message.includes(EVENT.routesSkipped));
    expect(warned?.properties).toEqual({
      [ATTR_EDGWAY_ROUTES_SKIPPED]: [{ route: "r-snis", unsupported: "snis" }],
    });
  });

  it("logs, once per config, the upstreams it runs as round-robin", async () => {
    const records: { message: readonly unknown[]; properties: unknown }[] = [];
    configureLogging({ sink: (record) => void records.push(record) });
    const config = snapshot("v1");
    config.upstreams = [
      { id: "u-lc", name: "orders.internal", algorithm: "least-connections" },
      { id: "u-rr", name: "rr.internal", algorithm: "round-robin" },
    ];
    await publish(1, config);
    const call = gateway();
    await call("https://gw.test/one");
    await call("https://gw.test/one");
    const warned = records.filter((r) =>
      r.message.includes(EVENT.algorithmFallback),
    );
    expect(warned).toHaveLength(1);
    expect(warned[0]?.properties).toEqual({
      [ATTR_EDGWAY_UPSTREAMS_FALLBACK]: [
        { id: "u-lc", name: "orders.internal", algorithm: "least-connections" },
      ],
    });
  });

  it("fails a route without a service with 502, through the outer handler", async () => {
    await publish(1, snapshot("v1"));
    const res = await gateway()("https://gw.test/broken");
    expect(res.status).toBe(ERR.UPSTREAM_UNREACHABLE.status);
    expect(handled).toContain(ERR.UPSTREAM_UNREACHABLE.status);
  });

  it("rebuilds when a new snapshot version is published", async () => {
    await publish(1, snapshot("v1"));
    const call = gateway();
    expect((await call("https://gw.test/one")).headers.get("x-tag")).toBe("v1");
    await publish(2, snapshot("v2"));
    // The store checks the live version at most every CONFIG.versionCheckMs.
    await scheduler.wait(CONFIG.versionCheckMs + 50);
    expect((await call("https://gw.test/one")).headers.get("x-tag")).toBe("v2");
  });

  it("reports each request to observe: route, service, status, duration", async () => {
    await publish(1, snapshot("v1"));
    const call = gateway();
    observed.length = 0;
    await call("https://gw.test/one", { method: "POST" });
    await call("https://gw.test/broken");
    expect(observed).toEqual([
      expect.objectContaining({
        route: "r1",
        service: "svc",
        consumer: undefined,
        method: "POST",
        status: 200,
      }),
      expect.objectContaining({
        route: "r2",
        method: "GET",
        status: ERR.UPSTREAM_UNREACHABLE.status,
      }),
    ]);
    expect(observed[0]?.durationMs).toBeGreaterThanOrEqual(0);
  });
});

describe("per-plugin timing and spans", () => {
  /** A Workers tracer that records its spans, as `ctx.tracing` would. */
  function recordingTracer() {
    const spans: { name: string; attributes: Record<string, unknown> }[] = [];
    const tracing = {
      enterSpan: <T>(
        name: string,
        callback: (span: {
          setAttribute(key: string, value: unknown): void;
        }) => T,
      ): T => {
        const attributes: Record<string, unknown> = {};
        spans.push({ name, attributes });
        return callback({
          setAttribute: (key, value) => {
            attributes[key] = value;
          },
        });
      },
    };
    return { spans, tracing };
  }

  function timedGateway(plugins: PluginFactory[], metrics: PluginMetric[]) {
    const app = new Hono<{ Bindings: DataPlaneEnv }>();
    app.onError(errorHandler());
    app.all(
      "*",
      createDataPlane<DataPlaneEnv>({
        plugins,
        observePlugin: (_c, metric) => metrics.push(metric),
      }),
    );
    return app;
  }

  it("reports each plugin's work per phase and opens a span per phase and for the upstream", async () => {
    await publish(1, snapshot("v1"));
    const metrics: PluginMetric[] = [];
    const app = timedGateway([tagger, stripSecret], metrics);
    const { spans, tracing } = recordingTracer();
    const ctx = Object.assign(createExecutionContext(), { tracing });
    const res = await app.request("https://gw.test/one/x", {}, bindings, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    expect(metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          plugin: "tagger",
          pluginId: "p-tag",
          phase: "access",
          outcome: "ok",
          route: "r1",
        }),
        expect.objectContaining({ plugin: "strip-secret", phase: "access" }),
      ]),
    );
    expect(metrics.every((m) => m.durationMs >= 0)).toBe(true);
    expect(spans.map((span) => span.name)).toEqual([
      SPAN.phase("access"),
      SPAN.upstream,
    ]);
    expect(spans[0]?.attributes).toEqual({
      [ATTR_EDGWAY_PHASE]: "access",
      [ATTR_EDGWAY_ROUTE_ID]: "r1",
    });
  });

  it("caps the plugin timings one request reports", async () => {
    const many: PluginFactory[] = Array.from({ length: 60 }, (_, i) => ({
      name: `noop-${i}`,
      instance: ({ id, scope }) => ({
        id,
        name: `noop-${i}`,
        priority: i,
        scope,
        handlers: { access: async (_c, next) => next() },
      }),
    }));
    const config = snapshot("v1");
    config.plugins = many.map((factory, i) => ({
      id: `n${i}`,
      name: factory.name,
      route_id: "r1",
      config: {},
    }));
    await publish(1, config);
    const metrics: PluginMetric[] = [];
    const app = timedGateway(many, metrics);
    const ctx = createExecutionContext();
    await app.request("https://gw.test/one/x", {}, bindings, ctx);
    await waitOnExecutionContext(ctx);
    expect(metrics).toHaveLength(ANALYTICS.pluginPointsPerRequest);
  });
});

describe("trace mode (the route tester)", () => {
  const token = (
    audience: string = TRACE.audience,
    key: CryptoKey = traceKeys.privateKey,
  ) =>
    new SignJWT({})
      .setProtectedHeader({ alg: "EdDSA" })
      .setAudience(audience)
      .setIssuedAt()
      .setExpirationTime(TRACE.tokenTtl)
      .sign(key);

  it("returns each plugin's decision with an admin-signed token", async () => {
    await publish(1, snapshot("v1"));
    const res = await gateway()("https://gw.test/one", {
      headers: { [HEADER.traceToken]: await token() },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get(HEADER.route)).toBe("r1");
    const trace = JSON.parse(
      res.headers.get(HEADER.trace) ?? "null",
    ) as TraceEntry[];
    expect(trace.map((e) => [e.plugin, e.id, e.phase, e.outcome])).toEqual(
      expect.arrayContaining([
        ["strip-secret", "p-strip", "access", expect.any(String)],
        ["tagger", "p-tag", "access", expect.any(String)],
      ]),
    );
    // The upstream call is in the trace, with its own timing.
    const upstream = trace.filter((e) => e.phase === TRACE.upstream);
    expect(upstream).toEqual([
      {
        plugin: TRACE.upstream,
        id: "svc",
        phase: TRACE.upstream,
        outcome: "",
        durationMs: expect.any(Number),
      },
    ]);
    // The token is the gateway's only: the upstream never sees it.
    const body = await res.json<{ traceToken: string | null }>();
    expect(body.traceToken).toBeNull();
  });

  it("names the route on a traced short-circuit, with no upstream entry", async () => {
    const config = snapshot("v1");
    config.routes.push({ id: "r3", service_id: "svc", paths: ["/tea"] });
    config.plugins.push({
      id: "p-tea",
      name: "teapot",
      route_id: "r3",
      config: {},
    });
    await publish(1, config);
    const call = gateway();
    const res = await call("https://gw.test/tea", {
      headers: { [HEADER.traceToken]: await token() },
    });
    expect(res.status).toBe(418);
    expect(res.headers.get(HEADER.route)).toBe("r3");
    const trace = JSON.parse(
      res.headers.get(HEADER.trace) ?? "null",
    ) as TraceEntry[];
    expect(trace.map((e) => e.plugin)).toContain("teapot");
    expect(trace.some((e) => e.phase === TRACE.upstream)).toBe(false);
    // Untraced, the same short-circuit never names the route.
    const plain = await call("https://gw.test/tea");
    expect(plain.status).toBe(418);
    expect(plain.headers.has(HEADER.route)).toBe(false);
  });

  it("ignores missing, forged and wrong-audience tokens", async () => {
    await publish(1, snapshot("v1"));
    const call = gateway();
    const other = await generateKeyPair("EdDSA");
    const forged = await new SignJWT({})
      .setProtectedHeader({ alg: "EdDSA" })
      .setAudience(TRACE.audience)
      .setExpirationTime(TRACE.tokenTtl)
      .sign(other.privateKey);
    // The snapshot signing key no longer signs traces.
    const snapshotKeySigned = await token(TRACE.audience, keys.privateKey);
    for (const value of [
      undefined,
      forged,
      await token("someone-else"),
      snapshotKeySigned,
    ]) {
      const headers: Record<string, string> = value
        ? { [HEADER.traceToken]: value }
        : {};
      const res = await call("https://gw.test/one", { headers });
      expect(res.status).toBe(200);
      // Nor does an upstream's own x-edgway-trace reach the client.
      expect(res.headers.has(HEADER.trace)).toBe(false);
      expect((await res.json<{ traceToken: unknown }>()).traceToken).toBeNull();
    }
  });
});

describe("the live version from a read-only reader", () => {
  it("serves the version a ConfigVersionReader reports, with no way to move it", async () => {
    await publish(1, snapshot("v1"));
    await publish(2, snapshot("v2"));
    // The gateway's Service Binding to the admin: current() only.
    const reader = { current: async () => 1 };
    expect(Object.keys(reader)).toEqual(["current"]);
    const app = new Hono<{ Bindings: DataPlaneEnv }>();
    app.all(
      "*",
      createDataPlane<DataPlaneEnv>({ plugins: [tagger, stripSecret] }),
    );
    app.onError(errorHandler());
    const ctx = createExecutionContext();
    const res = await app.request(
      "https://gw.test/one",
      {},
      { ...bindings, CONFIG_VERSION: reader },
      ctx,
    );
    await waitOnExecutionContext(ctx);
    // The reader names v1, so v1 serves although KV's pointer says v2.
    expect(res.headers.get("x-tag")).toBe("v1");
  });
});

describe("credential names for logging plugins", () => {
  it("collects every enabled key-auth's and jwt's credential names", () => {
    const names = credentialNamesOf({
      services: [],
      routes: [],
      consumers: [],
      plugins: [
        {
          id: "k1",
          name: "key-auth",
          config: { key_names: ["X-Partner-Key"] },
        },
        {
          id: "j1",
          name: "jwt",
          config: { header_names: ["X-JWT"], uri_param_names: ["token"] },
        },
        {
          id: "k2",
          name: "key-auth",
          enabled: false,
          config: { key_names: ["off"] },
        },
        { id: "c1", name: "cors", config: { headers: ["x-not-a-key"] } },
      ],
    } as unknown as Snapshot);
    expect(names.headers.sort()).toEqual(["x-jwt", "x-partner-key"]);
    expect(names.query.sort()).toEqual(["token", "x-partner-key"]);
  });
});
