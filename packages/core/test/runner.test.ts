import { ERR, errorHandler, fail, problemResponse } from "@edgway/errors";
import { CircuitBreakerPolicy } from "cockatiel";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { describe, expect, it, vi } from "vitest";
import {
  type PluginEvent,
  type PluginHandlers,
  type PluginInstance,
  type PluginScope,
  pinClientIp,
  rewritePhase,
  routePhases,
  selectPlugins,
  setConsumer,
  setConsumerGroups,
} from "../src/index";

let ids = 0;
/** Unique ids: circuit breakers are kept per plugin id per isolate. */
function plugin(
  name: string,
  priority: number,
  handlers: PluginHandlers,
  extra: Partial<PluginInstance> & { scope?: PluginScope } = {},
): PluginInstance {
  return { id: `p${++ids}`, name, priority, scope: {}, handlers, ...extra };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function gateway(plugins: PluginInstance[]) {
  const trace: string[] = [];
  const events: PluginEvent[] = [];
  const onEvent = (e: PluginEvent) => events.push(e);
  const app = new Hono();
  app.onError(errorHandler());
  app.use(rewritePhase(plugins, { onEvent }));
  app.all(
    "/r/*",
    routePhases({ route: "r1", service: "s1", plugins }, { onEvent }),
    (c) => {
      trace.push("upstream");
      return c.text("upstream body");
    },
  );
  return { app, trace, events };
}

/** An access handler that records its name and continues. */
const mark =
  (trace: string[], name: string): PluginHandlers["access"] =>
  async (_c, next) => {
    trace.push(name);
    await next();
  };

describe("selectPlugins (Kong precedence)", () => {
  const scoped = (scope: PluginScope) =>
    plugin("rate-limiting", 910, {}, { scope });
  const global = scoped({});
  const service = scoped({ service: "s1" });
  const route = scoped({ route: "r1" });
  const routeService = scoped({ route: "r1", service: "s1" });
  const consumer = scoped({ consumer: "c1" });
  const all = [global, service, route, routeService, consumer];

  it("global < service < route < consumer: the most specific wins", () => {
    expect(selectPlugins([global, service], { service: "s1" })).toEqual([
      service,
    ]);
    expect(
      selectPlugins([global, service, route], { route: "r1", service: "s1" }),
    ).toEqual([route]);
    expect(selectPlugins(all, { route: "r1", service: "s1" })).toEqual([
      routeService,
    ]);
    expect(
      selectPlugins([global, service, route, consumer], {
        route: "r1",
        service: "s1",
        consumer: { id: "c1" },
      }),
    ).toEqual([consumer]);
  });

  it("follows Kong's full table: route+service outranks a consumer alone", () => {
    const request = { route: "r1", service: "s1", consumer: { id: "c1" } };
    expect(selectPlugins(all, request)).toEqual([routeService]);
    const consumerRoute = scoped({ consumer: "c1", route: "r1" });
    expect(selectPlugins([...all, consumerRoute], request)).toEqual([
      consumerRoute,
    ]);
  });

  it("ignores instances bound elsewhere", () => {
    expect(selectPlugins(all, { route: "r2", service: "s2" })).toEqual([
      global,
    ]);
  });

  it("matches consumer groups", () => {
    const group = scoped({ consumer_group: "gold" });
    expect(
      selectPlugins([global, group], {
        consumer: { id: "c9", consumerGroups: ["gold"] },
      }),
    ).toEqual([group]);
  });
});

describe("routePhases", () => {
  it("keeps the pinned client IP for every later plugin and the upstream", async () => {
    const seen: (string | undefined)[] = [];
    const forge: PluginHandlers["access"] = async (c, next) => {
      const headers = new Headers(c.req.raw.headers);
      headers.set("cf-connecting-ip", "10.0.0.1");
      c.req.raw = new Request(c.req.raw, { headers });
      await next();
    };
    const look: PluginHandlers["access"] = async (c, next) => {
      seen.push(c.req.header("cf-connecting-ip"));
      await next();
    };
    const app = new Hono();
    app.onError(errorHandler());
    app.use(async (c, next) => {
      pinClientIp(c, c.req.header("cf-connecting-ip"));
      await next();
    });
    const plugins = [
      plugin("forger", 2000, { access: forge }),
      plugin("ip-restriction", 990, { access: look }),
    ];
    app.all("/r/*", routePhases({ route: "r1", service: "s1", plugins }), (c) =>
      c.text(c.req.header("cf-connecting-ip") ?? "none"),
    );
    const res = await app.request("/r/x", {
      headers: { "cf-connecting-ip": "203.0.113.7" },
    });
    expect(seen).toEqual(["203.0.113.7"]);
    expect(await res.text()).toBe("203.0.113.7");
    // No IP from the platform: a plugin can't invent one either.
    seen.length = 0;
    await app.request("/r/x");
    expect(seen).toEqual([undefined]);
  });

  it("runs access plugins by descending priority, then the upstream", async () => {
    const trace: string[] = [];
    const g = gateway([
      plugin("low", 1000, { access: mark(trace, "low") }),
      plugin("high", 2000, { access: mark(trace, "high") }),
      plugin("mid", 1500, { access: mark(trace, "mid") }),
    ]);
    const res = await g.app.request("/r/x");
    expect(res.status).toBe(200);
    expect(trace).toEqual(["high", "mid", "low"]);
    expect(g.trace).toEqual(["upstream"]);
  });

  it("uses the most specific instance at run time", async () => {
    const trace: string[] = [];
    const g = gateway([
      plugin("cors", 2000, { access: mark(trace, "global") }),
      plugin(
        "cors",
        2000,
        { access: mark(trace, "route") },
        { scope: { route: "r1" } },
      ),
      plugin(
        "cors",
        2000,
        { access: mark(trace, "other") },
        { scope: { route: "r2" } },
      ),
    ]);
    await g.app.request("/r/x");
    expect(trace).toEqual(["route"]);
  });

  it("adds consumer-scoped plugins once an auth plugin sets the consumer", async () => {
    const trace: string[] = [];
    const g = gateway([
      plugin(
        "key-auth",
        1250,
        {
          access: async (c, next) => {
            setConsumer(c, { id: "alice" });
            await next();
          },
        },
        { enforces: "auth" },
      ),
      plugin(
        "rate-limiting",
        910,
        { access: mark(trace, "route limit") },
        { scope: { route: "r1" } },
      ),
      plugin(
        "rate-limiting",
        910,
        { access: mark(trace, "alice limit") },
        { scope: { consumer: "alice" } },
      ),
    ]);
    await g.app.request("/r/x");
    expect(trace).toEqual(["alice limit"]);
  });

  it("adds consumer-group plugins from the gateway's group resolver", async () => {
    const trace: string[] = [];
    const g = gateway([
      plugin("groups", Number.MAX_SAFE_INTEGER, {
        access: async (c, next) => {
          setConsumerGroups(c, (id) => (id === "alice" ? ["gold"] : []));
          await next();
        },
      }),
      plugin(
        "key-auth",
        1250,
        {
          access: async (c, next) => {
            setConsumer(c, { id: c.req.header("x-who") ?? "" });
            await next();
          },
        },
        { enforces: "auth" },
      ),
      plugin(
        "rate-limiting",
        910,
        { access: mark(trace, "route limit") },
        { scope: { route: "r1" } },
      ),
      plugin(
        "rate-limiting",
        910,
        { access: mark(trace, "gold limit") },
        { scope: { consumer_group: "gold" } },
      ),
    ]);
    await g.app.request("/r/x", { headers: { "x-who": "alice" } });
    await g.app.request("/r/x", { headers: { "x-who": "bob" } });
    expect(trace).toEqual(["gold limit", "route limit"]);
  });

  it("never scopes plugins by groups a credential or token claims", async () => {
    const trace: string[] = [];
    const g = gateway([
      plugin(
        "oidc",
        1050,
        {
          access: async (c, next) => {
            // A token's groups claim, and a forged membership: neither counts.
            setConsumer(c, {
              id: "mallory",
              groups: ["gold"],
              consumerGroups: ["gold"],
            });
            await next();
          },
        },
        { enforces: "auth" },
      ),
      plugin(
        "rate-limiting",
        910,
        { access: mark(trace, "route limit") },
        { scope: { route: "r1" } },
      ),
      plugin(
        "rate-limiting",
        910,
        { access: mark(trace, "gold limit") },
        { scope: { consumer_group: "gold" } },
      ),
    ]);
    await g.app.request("/r/x");
    expect(trace).toEqual(["route limit"]);
  });

  it("short-circuits in access: later plugins and the upstream don't run", async () => {
    const trace: string[] = [];
    const g = gateway([
      plugin("deny", 2000, {
        access: async () => problemResponse(ERR.AUTH_REQUIRED),
      }),
      plugin("after", 1000, { access: mark(trace, "after") }),
    ]);
    const res = await g.app.request("/r/x");
    expect(res.status).toBe(ERR.AUTH_REQUIRED.status);
    expect(trace).toEqual([]);
    expect(g.trace).toEqual([]);
    expect(g.events.map((e) => e.outcome)).toEqual(["short-circuit"]);
  });

  it("treats a thrown deliberate error as a short circuit; later phases still run", async () => {
    const seen: string[] = [];
    const g = gateway([
      plugin(
        "key-auth",
        1250,
        { access: () => fail(ERR.AUTH_REQUIRED) },
        { enforces: "auth" },
      ),
      plugin("cors", 2000, {
        header_filter: (c) => {
          seen.push(`header_filter ${c.res.status}`);
        },
      }),
      plugin("http-log", 12, {
        log: (c) => {
          seen.push(`log ${c.res.status}`);
        },
      }),
    ]);
    const res = await g.app.request("/r/x");
    expect(res.status).toBe(ERR.AUTH_REQUIRED.status);
    expect(g.trace).toEqual([]);
    await sleep(5);
    expect(seen).toEqual([
      `header_filter ${ERR.AUTH_REQUIRED.status}`,
      `log ${ERR.AUTH_REQUIRED.status}`,
    ]);
    expect(
      g.events.map((e) => [e.plugin.name, e.phase, e.outcome]),
    ).toContainEqual(["key-auth", "access", "short-circuit"]);
  });

  it("turns Hono's HTTPException into the response it carries", async () => {
    const app = new Hono();
    const logged: number[] = [];
    const plugins = [
      plugin("auth", 1000, {
        access: () => {
          throw new HTTPException(403, { message: "forbidden" });
        },
      }),
      plugin("http-log", 12, { log: (c) => void logged.push(c.res.status) }),
    ];
    app.all("/r/*", routePhases({ route: "r1", plugins }), (c) => c.text("up"));
    expect((await app.request("/r/x")).status).toBe(403);
    await sleep(5);
    expect(logged).toEqual([403]);
  });

  it("fails closed on a timeout (auth plugins by default)", async () => {
    const g = gateway([
      plugin(
        "slow-auth",
        1000,
        {
          access: async (_c, next) => {
            await sleep(200);
            await next();
          },
        },
        { enforces: "auth", timeoutMs: 20 },
      ),
    ]);
    const res = await g.app.request("/r/x");
    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toContain(
      "application/problem+json",
    );
    expect(g.trace).toEqual([]);
    expect(g.events[0]?.outcome).toBe("timeout");
    await sleep(250);
    expect(g.trace).toEqual([]); // the abandoned handler can't reach the upstream later
  });

  it("fails closed when a rate-limiting plugin breaks (store down)", async () => {
    const g = gateway([
      plugin(
        "rate-limiting",
        910,
        {
          access: () => {
            throw new Error("counter store unreachable");
          },
        },
        { enforces: "rate-limit" },
      ),
    ]);
    const res = await g.app.request("/r/x");
    expect(res.status).toBe(ERR.INTERNAL.status);
    expect(g.trace).toEqual([]);
    expect(g.events[0]).toMatchObject({ outcome: "error", phase: "access" });
  });

  it("gives consumer-scoped plugins the later phases when auth sets the consumer and rejects", async () => {
    const logged: string[] = [];
    const g = gateway([
      plugin(
        "key-auth",
        1250,
        {
          access: async (c) => {
            setConsumer(c, { id: "mallory" });
            return problemResponse(ERR.AUTH_REQUIRED);
          },
        },
        { enforces: "auth" },
      ),
      plugin(
        "http-log",
        12,
        { log: () => void logged.push("mallory log") },
        { scope: { consumer: "mallory" } },
      ),
    ]);
    await g.app.request("/r/x");
    await sleep(5);
    expect(logged).toEqual(["mallory log"]);
  });

  it("fails open on a thrown error", async () => {
    const g = gateway([
      plugin("buggy", 1000, {
        access: () => {
          throw new Error("boom");
        },
      }),
    ]);
    const res = await g.app.request("/r/x");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("upstream body");
    expect(g.events[0]).toMatchObject({ outcome: "error", phase: "access" });
  });

  it("honours an explicit on_error", async () => {
    const g = gateway([
      plugin(
        "strict",
        1000,
        {
          access: () => {
            throw new Error("boom");
          },
        },
        { on_error: "fail-closed" },
      ),
    ]);
    expect((await g.app.request("/r/x")).status).toBe(500);
  });

  it("opens the circuit after repeated failures", async () => {
    const buggy = plugin("flaky", 1000, {
      access: () => {
        throw new Error("boom");
      },
    });
    const g = gateway([buggy]);
    for (let i = 0; i < 6; i++) await g.app.request("/r/x");
    expect(g.events.at(-1)?.outcome).toBe("circuit-open");
  });

  it("never opens a plugin's circuit on timeouts a client can cause", async () => {
    let slow = true;
    const g = gateway([
      plugin(
        "body-reader",
        1000,
        {
          access: async (_c, next) => {
            if (slow) await sleep(60);
            await next();
          },
        },
        { enforces: "policy", timeoutMs: 10 },
      ),
    ]);
    for (let i = 0; i < 7; i++) {
      expect((await g.app.request("/r/x")).status).toBe(500);
    }
    expect(g.events.every((e) => e.outcome === "timeout")).toBe(true);
    // The next normal request still runs the plugin: no circuit opened.
    slow = false;
    expect((await g.app.request("/r/x")).status).toBe(200);
    expect(g.events.at(-1)?.outcome).toBe("ok");
  });

  it("fails closed when a fail-open plugin times out mid-body", async () => {
    const g = gateway([
      plugin(
        "transformer",
        801,
        {
          access: async (c, next) => {
            // Starts reading the body, which never finishes in time.
            const reader = c.req.raw.body?.getReader();
            await reader?.read();
            await sleep(100);
            await next();
          },
        },
        { timeoutMs: 20 },
      ),
    ]);
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("part"));
      },
    });
    const res = await g.app.request("/r/x", {
      method: "POST",
      body,
      duplex: "half",
    } as RequestInit);
    expect(res.status).toBe(500);
    expect(g.trace).toEqual([]);
    expect(g.events[0]?.outcome).toBe("timeout");
  });

  it("skips a fail-open plugin that times out before touching the body", async () => {
    const g = gateway([
      plugin(
        "cors",
        2000,
        {
          access: async (_c, next) => {
            await sleep(100);
            await next();
          },
        },
        { timeoutMs: 20 },
      ),
    ]);
    expect((await g.app.request("/r/x")).status).toBe(200);
    expect(g.events[0]?.outcome).toBe("timeout");
  });

  it("runs header_filter and body_filter on the response, streaming", async () => {
    const g = gateway([
      plugin("headers", 800, {
        header_filter: (c) => {
          c.res.headers.set("x-filtered", "yes");
        },
      }),
      plugin("upper", 700, {
        body_filter: () =>
          new TransformStream<Uint8Array, Uint8Array>({
            transform(chunk, controller) {
              controller.enqueue(
                new TextEncoder().encode(
                  new TextDecoder().decode(chunk).toUpperCase(),
                ),
              );
            },
          }),
      }),
    ]);
    const res = await g.app.request("/r/x");
    expect(res.headers.get("x-filtered")).toBe("yes");
    expect(await res.text()).toBe("UPSTREAM BODY");
  });

  it("fails closed after the upstream without leaking its headers", async () => {
    const app = new Hono();
    const plugins = [
      plugin(
        "strict-headers",
        800,
        {
          header_filter: () => {
            throw new Error("boom");
          },
        },
        { on_error: "fail-closed" },
      ),
    ];
    app.all(
      "/r/*",
      routePhases({ route: "r1", plugins }),
      () =>
        new Response("upstream body", {
          headers: {
            "content-length": "13",
            "content-encoding": "gzip",
            "set-cookie": "session=secret",
          },
        }),
    );
    const res = await app.request("/r/x");
    expect(res.status).toBe(ERR.INTERNAL.status);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(res.headers.get("content-encoding")).toBeNull();
    expect(res.headers.get("content-type")).toContain(
      "application/problem+json",
    );
    const body = await res.text();
    expect(res.headers.get("content-length") ?? String(body.length)).toBe(
      String(new TextEncoder().encode(body).length),
    );
  });

  it("drops content-length when a body_filter transforms the body", async () => {
    const app = new Hono();
    const plugins = [
      plugin("identity", 700, { body_filter: () => new TransformStream() }),
    ];
    app.all(
      "/r/*",
      routePhases({ route: "r1", plugins }),
      () =>
        new Response("abc", {
          headers: { "content-length": "3", "x-up": "1" },
        }),
    );
    const res = await app.request("/r/x");
    expect(res.headers.get("content-length")).toBeNull();
    expect(res.headers.get("x-up")).toBe("1");
    expect(await res.text()).toBe("abc");
  });

  it("runs log after the response, inside waitUntil", async () => {
    const pending: Promise<unknown>[] = [];
    const ctx = {
      waitUntil: (p: Promise<unknown>) => pending.push(p),
      passThroughOnException: () => {},
      props: {},
    };
    const logged: number[] = [];
    const g = gateway([
      plugin("http-log", 12, { log: (c) => void logged.push(c.res.status) }),
    ]);
    const res = await g.app.fetch(new Request("http://gw/r/x"), {}, ctx);
    expect(res.status).toBe(200);
    expect(logged).toEqual([]); // not before the response is returned
    await Promise.all(pending);
    expect(logged).toEqual([200]);
  });

  it("runs log even when access short-circuits", async () => {
    const logged: number[] = [];
    const g = gateway([
      plugin("deny", 2000, {
        access: async () => problemResponse(ERR.RATE_LIMITED),
      }),
      plugin("http-log", 12, { log: (c) => void logged.push(c.res.status) }),
    ]);
    await g.app.request("/r/x");
    await sleep(5);
    expect(logged).toEqual([ERR.RATE_LIMITED.status]);
  });

  it("reports per-plugin timing", async () => {
    const g = gateway([
      plugin("timed", 1000, { access: async (_c, next) => next() }),
    ]);
    await g.app.request("/r/x");
    expect(g.events).toEqual([
      expect.objectContaining({
        phase: "access",
        outcome: "ok",
        durationMs: expect.any(Number),
      }),
    ]);
  });
});

describe("rewritePhase", () => {
  it("runs global plugins before routing, and only global ones", async () => {
    const trace: string[] = [];
    const g = gateway([
      plugin("g", 100, { rewrite: mark(trace, "global") }),
      plugin(
        "r",
        100,
        { rewrite: mark(trace, "route") },
        { scope: { route: "r1" } },
      ),
    ]);
    const res = await g.app.request("/elsewhere");
    expect(res.status).toBe(404);
    expect(trace).toEqual(["global"]);
  });
});

describe("guard", () => {
  it("gives every plugin call its own abort signal (no cross-request I/O)", async () => {
    const execute = vi.spyOn(CircuitBreakerPolicy.prototype, "execute");
    const g = gateway([
      plugin("p", 1000, { access: async (_c, next) => next() }),
    ]);
    await g.app.request("/r/x");
    await g.app.request("/r/x");
    const signals = execute.mock.calls.map((call) => call[1]);
    expect(signals).toHaveLength(2);
    expect(signals[0]).toBeInstanceOf(AbortSignal);
    expect(signals[0]).not.toBe(signals[1]);
    execute.mockRestore();
  });
});

describe("phase spans", () => {
  it("runs each phase with plugins inside the span hook, in Kong's order", async () => {
    const spans: string[] = [];
    const plugins = [
      plugin("rewriter", 900, { rewrite: async (_c, next) => next() }),
      plugin("auth", 800, { access: async (_c, next) => next() }),
      plugin("headers", 700, { header_filter: () => {} }),
      plugin("body", 600, { body_filter: () => undefined }),
      plugin("logger", 500, { log: () => {} }),
    ];
    const span = async <T>(
      _c: unknown,
      phase: string,
      work: () => Promise<T>,
    ): Promise<T> => {
      spans.push(`start ${phase}`);
      try {
        return await work();
      } finally {
        spans.push(`end ${phase}`);
      }
    };
    const app = new Hono();
    app.use(rewritePhase(plugins, { span }));
    app.all(
      "/r/*",
      routePhases({ route: "r1", service: "s1", plugins }, { span }),
      (c) => {
        spans.push("upstream");
        return c.text("ok");
      },
    );
    const res = await app.request("/r/x");
    expect(res.status).toBe(200);
    await sleep(5);
    // rewrite and access are middleware: their spans enclose what follows.
    expect(spans).toEqual([
      "start rewrite",
      "start access",
      "upstream",
      "end access",
      "start header_filter",
      "end header_filter",
      "start body_filter",
      "end body_filter",
      "end rewrite",
      "start log",
      "end log",
    ]);
  });

  it("opens no span for a phase without plugins", async () => {
    const phases: string[] = [];
    const plugins = [
      plugin("auth", 800, { access: async (_c, next) => next() }),
    ];
    const app = new Hono();
    app.use(
      rewritePhase(plugins, {
        span: (_c, phase, work) => {
          phases.push(phase);
          return work();
        },
      }),
    );
    app.all(
      "/r/*",
      routePhases(
        { route: "r1", plugins },
        {
          span: (_c, phase, work) => {
            phases.push(phase);
            return work();
          },
        },
      ),
      (c) => c.text("ok"),
    );
    await app.request("/r/x");
    expect(phases).toEqual(["access"]);
  });
});
