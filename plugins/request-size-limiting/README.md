# @edgway/plugin-request-size-limiting

Kong's [request-size-limiting](https://developer.konghq.com/plugins/request-size-limiting/) plugin (priority 951) for Edgway, built on `hono/body-limit`. It never buffers a body. It can also be used as plain Hono middleware:

```ts
import sizeLimit from "@edgway/plugin-request-size-limiting";

app.use(sizeLimit.middleware({ allowed_payload_size: 8, size_unit: "megabytes" }));
```

## Supported config

- `allowed_payload_size`, `size_unit` (`bytes`, `kilobytes`, `megabytes`; binary multiples, as in Kong)
- `require_content_length`: a request without `Content-Length` gets 411 "A valid Content-Length header is required" (EDG-PLG-002).

How the limit is enforced:

- **With `Content-Length`:** hono/body-limit rejects an oversized request with 413 "Request size limit exceeded" (EDG-PLG-001) before reading anything. The upstream is never called.
- **Without it (chunked):** the body streams through a byte counter. Past the limit the stream fails, which aborts the upload, and the client gets the same 413.

## Differences from Kong

- **Chunked bodies.** Kong buffers a chunked body to measure it before proxying. Edgway streams it (Workers isolates have 128 MB), so the upstream may already have received the start of a body that ends up rejected. The upload is aborted, never delivered truncated.
- **Content-Length together with Transfer-Encoding.** Such a request counts as chunked, following HTTP/1.1, so `require_content_length` answers it with 411. Kong checks Content-Length whenever the header is present.
