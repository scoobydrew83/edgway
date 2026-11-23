# @edgway/plugin-proxy-cache

Kong's [proxy-cache](https://developer.konghq.com/plugins/proxy-cache/) plugin (priority 100) for Edgway. It runs on Edgway's `CacheStore`, which is Workers Cache in the gateway. The gateway supplies the store, its cache-key function and the credential query names through `setProxyCacheBackend(c, backend)`.

```ts
import proxyCache, { setProxyCacheBackend } from "@edgway/plugin-proxy-cache";

app.use((c, next) => (setProxyCacheBackend(c, { store, key: cacheKey }), next()));
app.use(proxyCache.middleware({ strategy: "memory", cache_ttl: 60 }));
```

## Supported config

- **What is cacheable:** `cache_ttl`, `request_method`, `response_code`, `content_type`. Content types match exactly as in Kong, charset included, and `*/*` or `type/*` wildcards are accepted.
- **Cache key:** `vary_headers`, `vary_query_params` (unset means all parameters) and `ignore_uri_case`. The consumer is part of the key, hashed by the gateway's key function. Credential query parameters (for example key-auth's `apikey`) are left out.
- **Never shared:** a response that sets cookies (`Set-Cookie`) is never stored; a request with cookies and no consumer bypasses the cache, since the upstream may answer each session differently; and a response whose `Vary` names a header outside `vary_headers` (other than `Accept-Encoding`), or `Vary: *`, is not stored.
- **`cache_control` (RFC 9111, as Kong applies it):**
  - Requests: `no-store`, `no-cache` or an `Authorization` header gives Bypass.
  - An entry that fails the request's `max-age`, `max-stale` or `min-fresh` is refreshed (Refresh).
  - Responses: `no-store`, `no-cache` or `private` are not stored.
  - The TTL comes from `s-maxage`, then `max-age`, then `Expires`. A response with none of these is not stored; `cache_ttl` applies only without `cache_control`.
- **`response_headers`:** switches `X-Cache-Status` (Hit, Miss, Refresh, Bypass), `X-Cache-Key` and `Age` on or off.
- **`strategy`:** `memory` is served by Workers Cache.

A cached response keeps the upstream's own `Cache-Control`. The storage headers the adapter adds (`Cache-Control`, `Cache-Tag`) never reach clients. Entries are tagged with the route and service ids for purging. HEAD requests are served from the GET entry, without a body. HEAD responses are never stored, so a HEAD miss reports Bypass where Kong would store it and report Miss.

## Unsupported Kong fields

- `memory.dictionary_name` and `storage_ttl`: Workers Cache keeps entries for their TTL.
- The Redis strategy (Enterprise).
