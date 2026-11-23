# @edgway/plugin-request-termination

Kong's [request-termination](https://developer.konghq.com/plugins/request-termination/) plugin (priority 2) for Edgway. It answers requests with a fixed response and never calls the upstream. It can also be used as plain Hono middleware:

```ts
import termination from "@edgway/plugin-request-termination";

app.use(termination.middleware({ status_code: 503, message: "Down for maintenance", trigger: "x-maintenance" }));
```

## Supported config

- `status_code` (default 503) and `message`: an Edgway problem (`EDG-PLG-003`) with that status and the message as its `detail`.
- `body` and `content_type` (default `application/json; charset=utf-8`): a raw response body instead.
- `echo`: returns the request as JSON (method, path, query, headers, URI captures, matched route, service and consumer).
- `trigger`: only requests carrying this header or query parameter are terminated. Others pass through.

A status that never carries a body (204, 205, 304) is answered without one.

## Differences from Kong

- **The default response body.** Kong sends `{"message": ...}`. Edgway sends problem+json, with the message in `detail`; the Kong-compatible error format converts it.
- **Echo.** The echo leaves out Kong's node information and the raw request body, because Edgway doesn't read bodies it doesn't need.
- **1xx status codes.** The Workers `Response` rejects them, so they are not usable.
