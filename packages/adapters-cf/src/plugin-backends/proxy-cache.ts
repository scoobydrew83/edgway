/**
 * proxy-cache's backend: the Workers Cache store (purge through the request's
 * `ctx.cache` when present) and the Kong-style cache key.
 */
import { cacheKey, createCacheStore } from "../cache/index.js";

export function proxyCacheBackend(
  /** The request's `ctx.cache`, when the runtime provides it. */
  purger: CacheContext | undefined,
  /** Query names that carry credentials; kept out of cache keys. */
  credentialParams: readonly string[],
) {
  return {
    store: createCacheStore({ purger }),
    key: cacheKey,
    credentialParams: [...credentialParams],
  };
}
