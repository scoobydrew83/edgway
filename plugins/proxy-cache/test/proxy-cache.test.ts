import {
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { HEADER } from "@edgway/constants";
import type { Consumer, PluginInstance } from "@edgway/core";
import type { PluginInput } from "@edgway/plugin-sdk";
import { testApp } from "@edgway/plugin-sdk/testing";
import type { Handler } from "hono";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import proxyCache, {
  type CacheKeyInput,
  type ProxyCacheBackend,
  setProxyCacheBackend,
} from "../src/index";

/** An in-memory backend that stores like the Workers Cache adapter does. */
function memoryBackend(credentialParams: string[] = []) {
  const entries = new Map<
    string,
    { body: string; status: number; headers: Headers }
  >();
  const keys: CacheKeyInput[] = [];
  const backend: ProxyCacheBackend = {
    credentialParams,
    key: async (input) => {
      keys.push(input);
      const url = new URL(input.url);
      for (const n of input.ignoreQuery ?? []) url.searchParams.delete(n);
      return JSON.stringify([
        url.toString(),
        input.method === "HEAD" ? "GET" : input.method,
        input.consumerId,
        input.vary,
      ]);
    },
    store: {
      match: async (key) => {
        const e = entries.get(key);
        return e
          ? new Response(e.body, { status: e.status, headers: e.headers })
          : undefined;
      },
      put: async (key, response, { ttlSeconds, tags }) => {
        const headers = new Headers(response.headers);
        headers.set("cache-control", `public,max-age=${ttlSeconds}`);
        if (tags?.length) headers.set("cache-tag", tags.join(","));
        entries.set(key, {
          body: await response.text(),
          status: response.status,
          headers,
        });
      },
      purge: async () => {},
    },
  };
  return { backend, entries, keys };
}

const withBackend = (backend: ProxyCacheBackend): PluginInstance => ({
  id: "cache-backend",
  name: "cache-backend",
  priority: Number.MAX_SAFE_INTEGER,
  scope: {},
  handlers: {
    access: async (c, next) => {
      setProxyCacheBackend(c, backend);
      await next();
    },
  },
});

let served = 0;
const upstream =
  (headers: Record<string, string> = {}, status = 200): Handler =>
  (c) => {
    served++;
    return c.json({ n: served, path: c.req.path }, status as 200, {
      "cache-control": "max-age=60",
      ...headers,
    });
  };

type Config = Omit<PluginInput<typeof proxyCache.config>, "strategy">;
function app(
  config: Config = {},
  opts: {
    backend?: ProxyCacheBackend;
    handler?: Handler;
    consumer?: Consumer;
  } = {},
) {
  const { backend } = opts.backend
    ? { backend: opts.backend }
    : memoryBackend();
  return testApp(
    proxyCache,
    { strategy: "memory", ...config },
    {
      plugins: [withBackend(backend)],
      upstream: opts.handler ?? upstream(),
      consumer: opts.consumer,
    },
  );
}

/** Request, then wait for the cache write. */
async function get(t: ReturnType<typeof app>, path = "/", init?: RequestInit) {
  const res = await t.request(path, init);
  const body = await res.text();
  await t.settle();
  return { res, body };
}

describe("proxy-cache", () => {
  it("uses Kong's name, priority and defaults", () => {
    expect(proxyCache.name).toBe("proxy-cache");
    expect(proxyCache.priority).toBe(100);
    expect(proxyCache.parse({ strategy: "memory" })).toMatchObject({
      cache_ttl: 300,
      request_method: ["GET", "HEAD"],
      response_code: [200, 301, 404],
      content_type: ["application/json", "text/plain"],
      cache_control: false,
    });
  });

  it("misses, stores, then hits with Kong's headers and the upstream's own Cache-Control", async () => {
    const t = app({ content_type: ["application/json"] });
    const first = await get(t);
    expect(first.res.headers.get("x-cache-status")).toBe("Miss");
    expect(first.res.headers.get("x-cache-key")).toBeTruthy();
    const second = await get(t);
    expect(second.res.headers.get("x-cache-status")).toBe("Hit");
    expect(second.body).toBe(first.body);
    expect(second.res.headers.get("age")).toBe("0");
    expect(second.res.headers.get("cache-control")).toBe("max-age=60");
    expect(second.res.headers.get("cache-tag")).toBeNull();
    expect(second.res.headers.get(HEADER.cachedAt)).toBeNull();
    expect(t.upstreamCalls).toHaveLength(1);
  });

  it("bypasses methods, statuses and content types it may not cache", async () => {
    const post = app();
    const res = await get(post, "/", { method: "POST" });
    expect(res.res.headers.get("x-cache-status")).toBe("Bypass");

    const error = app({}, { handler: upstream({}, 500) });
    expect((await get(error)).res.headers.get("x-cache-status")).toBe("Bypass");
    expect((await get(error)).res.headers.get("x-cache-status")).toBe("Bypass");
    expect(error.upstreamCalls).toHaveLength(2);

    // Kong matches content types exactly: charset included.
    const typed = app({ content_type: ["application/json; charset=utf-8"] });
    expect((await get(typed)).res.headers.get("x-cache-status")).toBe("Bypass");
  });

  it("keys on vary_headers, vary_query_params, the consumer and ignore_uri_case", async () => {
    const { backend } = memoryBackend();
    const t = app(
      { vary_headers: ["x-lang"], content_type: ["application/json"] },
      { backend },
    );
    await get(t, "/", { headers: { "x-lang": "en" } });
    expect(
      (await get(t, "/", { headers: { "x-lang": "fr" } })).res.headers.get(
        "x-cache-status",
      ),
    ).toBe("Miss");
    expect(
      (await get(t, "/", { headers: { "x-lang": "en" } })).res.headers.get(
        "x-cache-status",
      ),
    ).toBe("Hit");

    const q = app({
      vary_query_params: ["page"],
      content_type: ["application/json"],
    });
    await get(q, "/?page=1&noise=a");
    expect(
      (await get(q, "/?page=1&noise=b")).res.headers.get("x-cache-status"),
    ).toBe("Hit");
    expect((await get(q, "/?page=2")).res.headers.get("x-cache-status")).toBe(
      "Miss",
    );

    const shared = memoryBackend().backend;
    await get(
      app(
        { content_type: ["application/json"] },
        { backend: shared, consumer: { id: "a" } },
      ),
    );
    const other = await get(
      app(
        { content_type: ["application/json"] },
        { backend: shared, consumer: { id: "b" } },
      ),
    );
    expect(other.res.headers.get("x-cache-status")).toBe("Miss");

    const cased = app({
      ignore_uri_case: true,
      content_type: ["application/json"],
    });
    await get(cased, "/Items");
    expect((await get(cased, "/items")).res.headers.get("x-cache-status")).toBe(
      "Hit",
    );
  });

  it("leaves credential query parameters out of the key", async () => {
    const { backend } = memoryBackend(["apikey"]);
    const t = app({ content_type: ["application/json"] }, { backend });
    await get(t, "/?apikey=one");
    expect(
      (await get(t, "/?apikey=two")).res.headers.get("x-cache-status"),
    ).toBe("Hit");
  });

  it("honors Cache-Control with cache_control, as Kong does", async () => {
    const cfg = { cache_control: true, content_type: ["application/json"] };
    const noStore = app(cfg, {
      handler: upstream({ "cache-control": "no-store" }),
    });
    await get(noStore);
    expect((await get(noStore)).res.headers.get("x-cache-status")).toBe(
      "Bypass",
    );

    const t = app(cfg);
    await get(t);
    for (const headers of [
      { "cache-control": "no-cache" },
      { "cache-control": "no-store" },
      { authorization: "Bearer x" },
    ] as Record<string, string>[]) {
      const res = await get(t, "/", { headers });
      expect(res.res.headers.get("x-cache-status")).toBe("Bypass");
    }
    expect((await get(t)).res.headers.get("x-cache-status")).toBe("Hit");
  });

  it("refreshes an entry that fails the request's freshness checks", async () => {
    const t = app({ cache_control: true, content_type: ["application/json"] });
    await get(t);
    // max-age=0: the entry (age 0) is still within max-age 0.
    expect(
      (
        await get(t, "/", { headers: { "cache-control": "max-age=0" } })
      ).res.headers.get("x-cache-status"),
    ).toBe("Hit");
    // min-fresh beyond the entry's 60 s TTL.
    const minFresh = await get(t, "/", {
      headers: { "cache-control": "min-fresh=120" },
    });
    expect(minFresh.res.headers.get("x-cache-status")).toBe("Refresh");
    expect(t.upstreamCalls).toHaveLength(2);
  });

  it("does not store a response without freshness information with cache_control", async () => {
    const t = app(
      { cache_control: true, content_type: ["application/json"] },
      { handler: upstream({ "cache-control": "public" }) },
    );
    await get(t);
    expect((await get(t)).res.headers.get("x-cache-status")).toBe("Bypass");
  });

  it("uses Expires when there is no max-age, with cache_control", async () => {
    const { backend, entries } = memoryBackend();
    const expires = new Date(Date.now() + 120_000).toUTCString();
    const t = app(
      { cache_control: true, content_type: ["application/json"] },
      { backend, handler: upstream({ "cache-control": "public", expires }) },
    );
    await get(t);
    const [entry] = [...entries.values()];
    const ttl = Number(entry?.headers.get("cache-control")?.split("=")[1]);
    expect(ttl).toBeGreaterThan(100);
    expect(ttl).toBeLessThanOrEqual(120);
  });

  it("uses s-maxage or max-age as the TTL with cache_control", async () => {
    const { backend, entries } = memoryBackend();
    const t = app(
      { cache_control: true, content_type: ["application/json"] },
      {
        backend,
        handler: upstream({
          "cache-control": "public, s-maxage=30, max-age=10",
        }),
      },
    );
    await get(t);
    const [entry] = [...entries.values()];
    expect(entry?.headers.get("cache-control")).toBe("public,max-age=30");
  });

  it("switches diagnostic headers with response_headers", async () => {
    const t = app({
      content_type: ["application/json"],
      response_headers: {
        age: false,
        "X-Cache-Status": false,
        "X-Cache-Key": false,
      },
    });
    await get(t);
    const hit = (await get(t)).res;
    expect(hit.headers.get("x-cache-status")).toBeNull();
    expect(hit.headers.get("x-cache-key")).toBeNull();
    expect(hit.headers.get("age")).toBeNull();
  });

  it("serves HEAD from the GET entry, without a body, and never stores HEAD", async () => {
    const t = app({ content_type: ["application/json"] });
    const headMiss = await get(t, "/", { method: "HEAD" });
    expect(headMiss.res.headers.get("x-cache-status")).toBe("Bypass");
    await get(t);
    const head = await get(t, "/", { method: "HEAD" });
    expect(head.res.headers.get("x-cache-status")).toBe("Hit");
    expect(head.body).toBe("");
  });

  it("never stores a response that sets cookies", async () => {
    const t = app({}, { handler: upstream({ "set-cookie": "session=abc" }) });
    expect((await get(t)).res.headers.get(HEADER.cacheStatus)).toBe("Bypass");
    const second = await get(t);
    expect(second.res.headers.get(HEADER.cacheStatus)).toBe("Bypass");
    expect(second.res.headers.get("set-cookie")).toBe("session=abc");
  });

  it("bypasses a request with cookies and no consumer", async () => {
    const t = app();
    const cookie = { headers: { cookie: "session=alice" } };
    expect(
      (await get(t, "/", cookie)).res.headers.get(HEADER.cacheStatus),
    ).toBe("Bypass");
    expect(
      (await get(t, "/", cookie)).res.headers.get(HEADER.cacheStatus),
    ).toBe("Bypass");
    // With a consumer, the key is theirs: cookies don't stop caching.
    const keyed = app({}, { consumer: { id: "c-1" } });
    await get(keyed, "/", cookie);
    expect(
      (await get(keyed, "/", cookie)).res.headers.get(HEADER.cacheStatus),
    ).toBe("Hit");
  });

  it("honours the upstream's Vary", async () => {
    // A header the key doesn't cover, or `*`: not stored.
    for (const vary of ["Accept-Language", "*", "Accept-Encoding, Origin"]) {
      const t = app({}, { handler: upstream({ vary }) });
      await get(t);
      expect((await get(t)).res.headers.get(HEADER.cacheStatus)).toBe("Bypass");
    }
    // Covered by vary_headers (or Accept-Encoding only): stored.
    const covered: [string, Config][] = [
      ["accept-language", { vary_headers: ["Accept-Language"] }],
      ["Accept-Encoding", {}],
    ];
    for (const [vary, config] of covered) {
      const t = app(config, { handler: upstream({ vary }) });
      await get(t);
      expect((await get(t)).res.headers.get(HEADER.cacheStatus)).toBe("Hit");
    }
  });

  it("bypasses without a cache backend", async () => {
    const t = testApp(
      proxyCache,
      { strategy: "memory" },
      { upstream: upstream() },
    );
    expect((await get(t)).res.headers.get("x-cache-status")).toBe("Bypass");
  });

  it("is also plain Hono middleware", async () => {
    const { backend } = memoryBackend();
    const plain = new Hono();
    plain.use(async (c, next) => {
      setProxyCacheBackend(c, backend);
      await next();
    });
    plain.use(
      proxyCache.middleware({
        strategy: "memory",
        content_type: ["application/json"],
      }),
    );
    plain.get("/", upstream());
    const send = async () => {
      const ctx = createExecutionContext();
      const res = await plain.fetch(new Request("https://x.test/"), {}, ctx);
      await waitOnExecutionContext(ctx);
      return res;
    };
    expect((await send()).headers.get("x-cache-status")).toBe("Miss");
    expect((await send()).headers.get("x-cache-status")).toBe("Hit");
  });
});
