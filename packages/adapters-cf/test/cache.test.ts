import { HEADER } from "@edgway/constants";
import { sha256Hex } from "@edgway/core";
import { describe, expect, it } from "vitest";
import {
  CachePurgeUnavailable,
  cacheKey,
  createCacheStore,
} from "../src/index";

const url = "https://gw.example/demo/ip?b=2&a=1";
let n = 0;
const fresh = () => `https://gw.example/cache-test/${++n}`;

describe("cacheKey", () => {
  it("keeps origin and path, sorts the client query, and is stable", async () => {
    const one = await cacheKey({ url, method: "GET" });
    expect(one.startsWith("https://gw.example/demo/ip?")).toBe(true);
    expect(
      await cacheKey({
        url: "https://gw.example/demo/ip?a=1&b=2",
        method: "GET",
      }),
    ).toBe(one);
  });

  it("never contains a raw consumer id or credential", async () => {
    const secret = "edg_live_SECRET_API_KEY";
    const key = await cacheKey({
      url,
      method: "GET",
      consumerId: secret,
      vary: { authorization: `Bearer ${secret}` },
    });
    expect(key).not.toContain(secret);
    expect(key).toContain(await sha256Hex(secret));
  });

  it("leaves credentials sent in the query out of the key", async () => {
    const secret = "edg_live_SECRET_API_KEY";
    const key = await cacheKey({
      url: `https://gw.example/demo/ip?apikey=${secret}&page=2`,
      method: "GET",
      consumerId: "alice",
      ignoreQuery: ["apikey"],
    });
    expect(key).not.toContain(secret);
    expect(key).toContain("page");
  });

  it("can't be forged from the query string", async () => {
    const alice = await cacheKey({
      url: "https://gw.example/demo/ip",
      method: "GET",
      consumerId: "alice",
    });
    const aliceHash = await sha256Hex("alice");
    for (const forged of [
      `https://gw.example/demo/ip?consumer=${aliceHash}`,
      `https://gw.example/demo/ip?edgway-consumer=${aliceHash}`,
      `https://gw.example/demo/ip?query=&consumer=${aliceHash}&vary=-&method=GET`,
    ]) {
      expect(await cacheKey({ url: forged, method: "GET" })).not.toBe(alice);
    }
    const post = await cacheKey({
      url: "https://gw.example/x",
      method: "POST",
    });
    expect(
      await cacheKey({
        url: "https://gw.example/x?method=POST",
        method: "GET",
      }),
    ).not.toBe(post);
  });

  it("separates consumers, varied headers and methods", async () => {
    const base = { url, method: "GET" };
    const keys = new Set([
      await cacheKey(base),
      await cacheKey({ ...base, consumerId: "alice" }),
      await cacheKey({ ...base, consumerId: "bob" }),
      await cacheKey({ ...base, vary: { "accept-language": "fr" } }),
      await cacheKey({ ...base, method: "POST" }),
    ]);
    expect(keys.size).toBe(5);
    expect(await cacheKey({ ...base, method: "HEAD" })).toBe(
      await cacheKey(base),
    );
    expect(await cacheKey({ ...base, vary: { "Accept-Language": "fr" } })).toBe(
      await cacheKey({ ...base, vary: { "accept-language": "fr" } }),
    );
  });
});

describe("CacheStore (Workers Cache)", () => {
  it("puts and matches, with TTL and tags", async () => {
    const store = createCacheStore();
    const key = fresh();
    expect(await store.match(key)).toBeUndefined();
    await store.put(key, new Response("cached body"), {
      ttlSeconds: 60,
      tags: ["route:r1", "service:s1"],
    });
    const hit = await store.match(key);
    expect(await hit?.text()).toBe("cached body");
    expect(hit?.headers.get(HEADER.cacheTag)).toBe("route:r1,service:s1");
    expect(hit?.headers.get(HEADER.cacheControl)).toBe("public,max-age=60");
  });

  it("doesn't store with a TTL of 0, and never stores Set-Cookie", async () => {
    const store = createCacheStore();
    const none = fresh();
    await store.put(none, new Response("x"), { ttlSeconds: 0 });
    expect(await store.match(none)).toBeUndefined();

    const key = fresh();
    await store.put(
      key,
      new Response("y", { headers: { [HEADER.setCookie]: "session=1" } }),
      { ttlSeconds: 60 },
    );
    const hit = await store.match(key);
    expect(await hit?.text()).toBe("y");
    expect(hit?.headers.get(HEADER.setCookie)).toBeNull();
  });

  it("purges by tag and URL prefix through ctx.cache (scheme-less path prefixes)", async () => {
    const calls: CachePurgeOptions[] = [];
    const store = createCacheStore({
      purger: {
        purge: async (options) => {
          calls.push(options);
          return { success: true, errors: [] };
        },
      },
    });
    await store.purge({
      tags: ["route:r1"],
      prefixes: ["https://gw.example/demo/"],
    });
    expect(calls).toEqual([
      { tags: ["route:r1"], pathPrefixes: ["gw.example/demo/"] },
    ]);
  });

  it("reports a failed purge", async () => {
    const store = createCacheStore({
      purger: {
        purge: async () => ({
          success: false,
          errors: [{ code: 1, message: "denied" }],
        }),
      },
    });
    await expect(store.purge({ tags: ["x"] })).rejects.toBeInstanceOf(
      AggregateError,
    );
  });

  it("fails loudly without ctx.cache, for tags and prefixes alike", async () => {
    const store = createCacheStore();
    await expect(store.purge({ tags: ["route:r1"] })).rejects.toBeInstanceOf(
      CachePurgeUnavailable,
    );
    await expect(
      store.purge({ prefixes: ["https://gw.example/demo/"] }),
    ).rejects.toBeInstanceOf(CachePurgeUnavailable);
  });
});
