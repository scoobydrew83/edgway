# @edgway/plugin-cors

Kong's [cors](https://developer.konghq.com/plugins/cors/) plugin (priority 2000) for Edgway, built on `hono/cors`. It can also be used as plain Hono middleware:

```ts
import cors from "@edgway/plugin-cors";

app.use(cors.middleware({ origins: ["https://app.example.com"], credentials: true }));
```

## Supported config

All of Kong's fields are supported:

- `origins`: empty, or `*` as the only entry, allows every origin. An entry made only of `[A-Za-z0-9.:/-]` is a plain origin: with a scheme it compares normalized origins (default ports dropped), and without a scheme it is compared as written. Any other entry is a regex anchored at both ends, as in Kong.
- `credentials`: with every origin allowed, the request's Origin is echoed back instead of `*`, as Kong does. **Any** site can then make credentialed requests (cookies, HTTP auth) and read the responses. Only combine `credentials: true` with an explicit `origins` list, unless the route's responses are safe for every site to read.
- `methods`, `headers` (when unset, the requested headers are echoed), `exposed_headers`, `max_age`
- `private_network`: `Access-Control-Allow-Private-Network: true` when the preflight asks for it.
- `preflight_continue`: the preflight goes upstream, and the upstream owns its CORS headers. As in Kong, the plugin adds none.

A preflight (`OPTIONS` with `Origin` and `Access-Control-Request-Method`) is answered with Kong's 200 and an empty body. Every other response, a plain `OPTIONS` included, gets Kong's response headers (`Access-Control-Allow-Origin`, `-Allow-Credentials`, `-Expose-Headers`) in `header_filter`, including error responses from other plugins such as auth failures and rate limits, so browsers can read them. A disallowed origin is not blocked; it just gets no `Access-Control-Allow-Origin`, as in Kong.
