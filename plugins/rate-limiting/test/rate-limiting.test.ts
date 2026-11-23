import type { Consumer, PluginInstance } from "@edgway/core";
import { errorHandler } from "@edgway/errors";
import type { PluginInput } from "@edgway/plugin-sdk";
import { testApp } from "@edgway/plugin-sdk/testing";
import { Hono } from "hono";
import { MemoryStore } from "hono-rate-limiter";
import { describe, expect, it } from "vitest";
import rateLimiting, {
  type RateLimitPolicy,
  type RateLimitStores,
  type RateLimitWindow,
  setRateLimitStores,
  type WindowStore,
} from "../src/index";

/** Fresh in-memory counters per window, recording which policy asked. */
function memoryStores(
  overrides: Partial<Record<RateLimitWindow, WindowStore>> = {},
) {
  const stores = new Map<RateLimitWindow, WindowStore>();
  const policies: RateLimitPolicy[] = [];
  const provider: RateLimitStores = {
    store(window, policy) {
      policies.push(policy);
      let store = overrides[window] ?? stores.get(window);
      if (!store) {
        store = new MemoryStore();
        stores.set(window, store);
      }
      return store;
    },
  };
  return { provider, policies };
}

const withStores = (provider: RateLimitStores): PluginInstance => ({
  id: "stores",
  name: "stores",
  priority: Number.MAX_SAFE_INTEGER,
  scope: {},
  handlers: {
    access: async (c, next) => {
      setRateLimitStores(c, provider);
      await next();
    },
  },
});

type Config = PluginInput<typeof rateLimiting.config>;
function app(
  config: Config,
  options: { consumer?: Consumer; provider?: RateLimitStores } = {},
) {
  const provider = options.provider ?? memoryStores().provider;
  return testApp(rateLimiting, config, {
    plugins: [withStores(provider)],
    consumer: options.consumer,
  });
}
const from = (ip: string, headers: Record<string, string> = {}) => ({
  headers: { "cf-connecting-ip": ip, ...headers },
});

describe("rate-limiting", () => {
  it("uses Kong's name, priority and defaults", () => {
    expect(rateLimiting.name).toBe("rate-limiting");
    expect(rateLimiting.priority).toBe(910);
    expect(rateLimiting.parse({ minute: 1 })).toMatchObject({
      limit_by: "consumer",
      policy: "local",
      fault_tolerant: true,
      hide_client_headers: false,
      error_code: 429,
      error_message: "API rate limit exceeded",
    });
  });

  it("limits a window and sends Kong's headers", async () => {
    const t = app({ minute: 2, limit_by: "ip" });
    const first = await t.request("/", from("192.0.2.1"));
    expect(first.status).toBe(200);
    expect(first.headers.get("x-ratelimit-limit-minute")).toBe("2");
    expect(first.headers.get("x-ratelimit-remaining-minute")).toBe("1");
    expect(first.headers.get("ratelimit-limit")).toBe("2");
    expect(first.headers.get("ratelimit-remaining")).toBe("1");
    expect(Number(first.headers.get("ratelimit-reset"))).toBeGreaterThan(0);
    expect((await t.request("/", from("192.0.2.1"))).status).toBe(200);
    const blocked = await t.request("/", from("192.0.2.1"));
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("x-ratelimit-remaining-minute")).toBe("0");
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await blocked.json()).toMatchObject({
      code: "EDG-RL-001",
      detail: "API rate limit exceeded",
    });
    expect(t.upstreamCalls).toHaveLength(2);
  });

  it("checks every configured window and reports the tightest", async () => {
    const t = app({ second: 5, minute: 2, limit_by: "ip" });
    const res = await t.request("/", from("192.0.2.1"));
    expect(res.headers.get("x-ratelimit-limit-second")).toBe("5");
    expect(res.headers.get("x-ratelimit-remaining-second")).toBe("4");
    expect(res.headers.get("x-ratelimit-limit-minute")).toBe("2");
    expect(res.headers.get("ratelimit-limit")).toBe("2");
    expect(res.headers.get("ratelimit-remaining")).toBe("1");
    await t.request("/", from("192.0.2.1"));
    expect((await t.request("/", from("192.0.2.1"))).status).toBe(429);
  });

  it("counts each window over its own length", async () => {
    const second = await app({ second: 5, limit_by: "ip" }).request(
      "/",
      from("192.0.2.1"),
    );
    expect(Number(second.headers.get("ratelimit-reset"))).toBe(1);
    const hour = await app({ hour: 5, limit_by: "ip" }).request(
      "/",
      from("192.0.2.1"),
    );
    expect(Number(hour.headers.get("ratelimit-reset"))).toBeGreaterThan(3500);
  });

  it("keeps windows apart when one store serves them all", async () => {
    const shared = new MemoryStore();
    const provider: RateLimitStores = { store: () => shared };
    const t = app({ second: 5, minute: 5, limit_by: "ip" }, { provider });
    const res = await t.request("/", from("192.0.2.1"));
    expect(res.headers.get("x-ratelimit-remaining-second")).toBe("4");
    expect(res.headers.get("x-ratelimit-remaining-minute")).toBe("4");
  });

  it("counts clients separately by ip, and consumers by consumer", async () => {
    const byIp = app({ minute: 1, limit_by: "ip" });
    expect((await byIp.request("/", from("192.0.2.1"))).status).toBe(200);
    expect((await byIp.request("/", from("192.0.2.2"))).status).toBe(200);
    expect((await byIp.request("/", from("192.0.2.1"))).status).toBe(429);

    const { provider } = memoryStores();
    const alice = app({ minute: 1 }, { consumer: { id: "alice" }, provider });
    const bob = app({ minute: 1 }, { consumer: { id: "bob" }, provider });
    expect((await alice.request("/", from("192.0.2.1"))).status).toBe(200);
    expect((await bob.request("/", from("192.0.2.1"))).status).toBe(200);
    expect((await alice.request("/", from("192.0.2.9"))).status).toBe(429);
  });

  it("falls back to the client IP without a consumer", async () => {
    const t = app({ minute: 1 });
    expect((await t.request("/", from("192.0.2.1"))).status).toBe(200);
    expect((await t.request("/", from("192.0.2.2"))).status).toBe(200);
    expect((await t.request("/", from("192.0.2.1"))).status).toBe(429);
  });

  it("limits by header and by path", async () => {
    const byHeader = app({
      minute: 1,
      limit_by: "header",
      header_name: "x-tenant",
    });
    expect(
      (await byHeader.request("/", from("192.0.2.1", { "x-tenant": "a" })))
        .status,
    ).toBe(200);
    expect(
      (await byHeader.request("/", from("192.0.2.2", { "x-tenant": "a" })))
        .status,
    ).toBe(429);
    expect(
      (await byHeader.request("/", from("192.0.2.2", { "x-tenant": "b" })))
        .status,
    ).toBe(200);

    const byPath = app({ minute: 1, limit_by: "path", path: "/hot" });
    expect((await byPath.request("/hot", from("192.0.2.1"))).status).toBe(200);
    expect((await byPath.request("/hot", from("192.0.2.2"))).status).toBe(429);
    // Other paths fall back to the client IP.
    expect((await byPath.request("/cold", from("192.0.2.3"))).status).toBe(200);
  });

  it("hides the headers with hide_client_headers", async () => {
    const t = app({ minute: 1, limit_by: "ip", hide_client_headers: true });
    const res = await t.request("/", from("192.0.2.1"));
    expect(res.headers.get("x-ratelimit-limit-minute")).toBeNull();
    expect(res.headers.get("ratelimit-limit")).toBeNull();
    const blocked = await t.request("/", from("192.0.2.1"));
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBeNull();
  });

  it("uses error_code and error_message", async () => {
    const t = app({
      minute: 1,
      limit_by: "ip",
      error_code: 503,
      error_message: "Slow down",
    });
    await t.request("/", from("192.0.2.1"));
    const res = await t.request("/", from("192.0.2.1"));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({
      code: "EDG-RL-001",
      detail: "Slow down",
    });
  });

  it("asks the gateway for local or cluster counters by policy", async () => {
    for (const [policy, expected] of [
      ["local", "local"],
      ["cluster", "cluster"],
      ["redis", "cluster"],
    ] as const) {
      const { provider, policies } = memoryStores();
      await app({ minute: 1, policy }, { provider }).request(
        "/",
        from("192.0.2.1"),
      );
      expect(policies[0]).toBe(expected);
    }
  });

  it("omits remaining counts for an inexact store (the Rate Limiting binding)", async () => {
    const inexact = Object.assign(new MemoryStore(), { exact: false });
    const { provider } = memoryStores({ minute: inexact });
    const res = await app({ minute: 5, limit_by: "ip" }, { provider }).request(
      "/",
      from("192.0.2.1"),
    );
    expect(res.headers.get("x-ratelimit-limit-minute")).toBe("5");
    expect(res.headers.get("x-ratelimit-remaining-minute")).toBeNull();
    expect(res.headers.get("ratelimit-remaining")).toBeNull();
  });

  it("lets requests through when the store fails, unless fault_tolerant is off", async () => {
    const broken: WindowStore = {
      increment: async () => {
        throw new Error("store down");
      },
      decrement: async () => {},
      resetKey: async () => {},
    };
    const { provider } = memoryStores({ minute: broken });
    const tolerant = await app({ minute: 1 }, { provider }).request(
      "/",
      from("192.0.2.1"),
    );
    expect(tolerant.status).toBe(200);
    const strict = await app(
      { minute: 1, fault_tolerant: false },
      { provider },
    ).request("/", from("192.0.2.1"));
    expect(strict.status).toBe(500);
  });

  it("fails closed without counter stores", async () => {
    const res = await testApp(rateLimiting, { minute: 1 }).request(
      "/",
      from("192.0.2.1"),
    );
    expect(res.status).toBe(500);
  });

  it("is also plain Hono middleware", async () => {
    const { provider } = memoryStores();
    const plain = new Hono();
    plain.onError(errorHandler());
    plain.use(async (c, next) => {
      setRateLimitStores(c, provider);
      await next();
    });
    plain.use(rateLimiting.middleware({ minute: 1, limit_by: "ip" }));
    plain.get("/", (c) => c.text("ok"));
    expect(await (await plain.request("/", from("192.0.2.1"))).text()).toBe(
      "ok",
    );
    expect((await plain.request("/", from("192.0.2.1"))).status).toBe(429);
  });
});
