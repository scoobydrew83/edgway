/**
 * The CacheStore adapter on Workers Cache: `caches.default` for get and put,
 * and `ctx.cache.purge` for global purge by tag or path prefix. Where
 * `ctx.cache` isn't available (local dev), purge deletes exact keys only.
 */
import { HEADER } from "@edgway/constants";
import { type CachePutOptions, type CacheStore, sha256Hex } from "@edgway/core";

/** Marks a key part that is absent (no consumer, nothing varied). */
const NONE = "-";

export interface CacheKeyInput {
  /** The request URL (its origin and path make prefix purges work). */
  url: string;
  method: string;
  /** The authenticated consumer's id; hashed into the key. */
  consumerId?: string;
  /** Request header values the response varies on (Kong's vary_headers). */
  vary?: Record<string, string | undefined>;
  /**
   * Query parameters left out of the key, such as credentials sent in the
   * query (key-auth's `key_names`). The consumer hash still separates clients.
   */
  ignoreQuery?: string[];
}

/**
 * Kong-style cache key as a URL: the request's origin and path, then fixed
 * parameters the client can't forge. The client's own query (sorted, minus
 * ignored names) is one encoded value, so it can't collide with the others.
 * The consumer id and varied header values are SHA-256 hashed: raw
 * credentials never reach the key.
 */
export async function cacheKey(input: CacheKeyInput): Promise<string> {
  const url = new URL(input.url);
  const query = new URLSearchParams(url.search);
  for (const name of input.ignoreQuery ?? []) query.delete(name);
  query.sort();

  const varied = Object.entries(input.vary ?? {})
    .map(([name, value]) => [name.toLowerCase(), value ?? ""])
    .sort(([a], [b]) => (a as string).localeCompare(b as string));

  const key = new URL(url.origin + url.pathname);
  key.search = new URLSearchParams({
    query: query.toString(),
    consumer: input.consumerId ? await sha256Hex(input.consumerId) : NONE,
    vary: varied.length > 0 ? await sha256Hex(JSON.stringify(varied)) : NONE,
    // Only GET and HEAD are cacheable; HEAD shares GET's entry.
    method: input.method === "HEAD" ? "GET" : input.method,
  }).toString();
  return key.toString();
}

/** Purge isn't available here (no `ctx.cache`, e.g. local dev). */
export class CachePurgeUnavailable extends Error {}

/** Cloudflare's purge prefixes are host and path, without the scheme. */
const pathPrefix = (prefix: string) => {
  const url = new URL(prefix);
  return url.host + url.pathname;
};

export interface CacheStoreOptions {
  /** Defaults to `caches.default`. */
  cache?: Cache;
  /** `ctx.cache` from the request's execution context, when available. */
  purger?: CacheContext;
}

export function createCacheStore(options: CacheStoreOptions = {}): CacheStore {
  const cache = () => options.cache ?? caches.default;
  const request = (key: string) => new Request(key, { method: "GET" });

  return {
    async match(key) {
      return (await cache().match(request(key))) ?? undefined;
    },

    async put(key: string, response: Response, put: CachePutOptions) {
      if (put.ttlSeconds <= 0) return;
      const headers = new Headers(response.headers);
      headers.set(HEADER.cacheControl, `public,max-age=${put.ttlSeconds}`);
      if (put.tags?.length) headers.set(HEADER.cacheTag, put.tags.join(","));
      // A per-user cookie must never be served to someone else.
      headers.delete(HEADER.setCookie);
      await cache().put(
        request(key),
        new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers,
        }),
      );
    },

    /**
     * Purge by tag, or by URL prefix (full URLs, e.g. `https://gw.example/demo/`).
     * Needs `ctx.cache`; the Cache API alone can only delete exact keys.
     */
    async purge(selector) {
      if (!options.purger) throw new CachePurgeUnavailable();
      const result = await options.purger.purge({
        tags: selector.tags,
        pathPrefixes: selector.prefixes?.map(pathPrefix),
      });
      if (!result.success) throw new AggregateError(result.errors);
    },
  };
}
