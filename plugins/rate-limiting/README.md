# @edgway/plugin-rate-limiting

Kong's [rate-limiting](https://developer.konghq.com/plugins/rate-limiting/) plugin (priority 910) for Edgway, built on `hono-rate-limiter`. It runs one limiter per configured window over the counter store the gateway supplies for that window.

The Edgway gateway counts every policy and window exactly in a **Durable Object counter** (`@edgway/adapters-cf`, the `RATE_LIMIT_COUNTER` binding): fixed windows aligned to UTC, like Kong's. Cloudflare's Rate Limiting binding isn't used, because its limit and period are fixed per binding in wrangler config and can't serve per-route limits. So `policy: local` and `cluster` behave the same, as one counter across all locations.

```ts
import rateLimiting, { setRateLimitStores } from "@edgway/plugin-rate-limiting";

const stores = { minute: new MemoryStore(), hour: new MemoryStore() }; // one per window
app.use((c, next) => (setRateLimitStores(c, { store: (window) => stores[window] }), next()));
app.use(rateLimiting.middleware({ minute: 60, limit_by: "ip" }));
```

## Supported config

- `second`, `minute`, `hour`, `day`, `month`, `year`: every configured window counts, and exceeding any one blocks.
- `limit_by`: `consumer`, `credential`, `ip`, `service`, `header` (`header_name`), `path` (`path`). When the value is missing, Kong falls back to the client IP (`CF-Connecting-IP`), and so does Edgway. Counters are scoped to the matched route and service, and the identifier is hashed (SHA-256) before it reaches a store.
- `policy`: `local` or `cluster` (`redis` is served by the cluster store).
- `error_code`, `error_message`: the rejection's status and problem `detail`. The default is 429 with code `EDG-RL-001`.
- `hide_client_headers`: removes all rate-limit headers, and `Retry-After`.
- `fault_tolerant`: when a counter store fails, the request goes through. With it off, the request fails closed (500).

Headers follow Kong:

- `X-RateLimit-Limit-<Window>` and `X-RateLimit-Remaining-<Window>` for every window;
- `RateLimit-Limit`, `RateLimit-Remaining` and `RateLimit-Reset` for the tightest window (fewest remaining; on a tie, the longer window);
- `Retry-After` when blocked.

A store marked `exact: false` (one that only answers allow or deny, such as a host's own approximate store) has its remaining counts left out of the headers. The gateway's stores are all exact.

Counter keys carry the window. A store that takes its window length from hono-rate-limiter's `init(windowMs)`, such as `MemoryStore`, must be one object per window.

## Unsupported Kong fields

- `consumer-group` in `limit_by`: falls back to the client IP.
- The `redis` settings and `sync_rate`: counters live in Cloudflare.

## Differences from Kong

- **Blocked requests:** hono-rate-limiter counts them. Kong reads usage first and does not count a request it blocks.
- **`policy: local`:** counted in the same shared Durable Object as `cluster`, so the limit is global rather than per node.
