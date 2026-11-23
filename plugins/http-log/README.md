# @edgway/plugin-http-log

Kong's [http-log](https://developer.konghq.com/plugins/http-log/) plugin (priority 12) for Edgway. After the response, it sends Kong's log entry to `http_endpoint` inside `waitUntil`, so the client never waits for it. Plugins never call `fetch` themselves. The gateway supplies the transport (fetch through `@edgway/adapters-cf`) with `setHttpLogTransport`, and optionally a retry queue with `setHttpLogQueue`. It can also be used as plain Hono middleware:

```ts
import httpLog, { setHttpLogQueue, setHttpLogTransport } from "@edgway/plugin-http-log";

const transport = { deliver: async (d, timeoutMs) => (await fetch(d.endpoint, { method: d.method, headers: d.headers, body: d.body, signal: AbortSignal.timeout(timeoutMs) })).ok };
app.use((c, next) => (setHttpLogTransport(c, transport), setHttpLogQueue(c, c.env.HTTP_LOG_RETRY), next()));
app.use(httpLog.middleware({ http_endpoint: "https://logs.example/ingest" }));
```

## Supported config

- `http_endpoint`: credentials in the URL (`https://user:pass@host`) become a Basic `Authorization` header, as in Kong.
- `method`, `headers`, `content_type` (`application/json`), `timeout` (ms).

**The log entry** follows Kong's basic serializer: `request` (method, uri, url, querystring, headers, size), `upstream_uri`, `response` (status, headers, size), `latencies`, `client_ip`, `started_at`, `route`, `service`, `consumer` and `authenticated_entity`. The `Authorization`, `Proxy-Authorization` and `Cookie` header values are replaced by `REDACTED`.

**Retries:** a delivery that fails (network error, timeout or a non-2xx answer) is handed to an optional retry queue, bound with `setHttpLogQueue`. The gateway binds a Cloudflare Queue there, and its consumer sends the `HttpLogDelivery` (endpoint, method, headers, body) again with backoff. Without a queue, a failed delivery is dropped. Without a transport, every entry goes straight to the queue.

## Unsupported Kong fields

- `custom_fields_by_lua`: there is no Lua.
- `queue.*` batching and `queue_size`: each request is sent as one entry. Retry timing belongs to the Queue consumer, not to `queue.max_retry_*`.
- `retry_count`, `flush_timeout`, `keepalive`: these are nginx-specific.

## Differences from Kong

- `latencies.proxy` is `-1`, because the upstream time isn't observable from a plugin. `latencies.request` and `latencies.kong` run from when the plugin's access phase starts.
