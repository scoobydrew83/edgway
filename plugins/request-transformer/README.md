# @edgway/plugin-request-transformer

Kong's [request-transformer](https://developer.konghq.com/plugins/request-transformer/) plugin (priority 801) for Edgway. It can also be used as plain Hono middleware:

```ts
import transformer from "@edgway/plugin-request-transformer";

app.use(transformer.middleware({ add: { headers: ["x-source:edge"] }, remove: { querystring: ["debug"] } }));
```

## Supported config

- `remove`, `rename`, `replace`, `add`, `append` on `headers`, `querystring` and `body`. They run in Kong's order, and the entries are `name:value` (or `old:new` for rename).
  - `replace` only changes a field that exists.
  - `add` only sets a missing one.
  - `append` adds another value. In a JSON body it turns the key into an array.
- **Body:** with any `body` operation configured, a JSON object (top-level keys) or a form-urlencoded body of at most 1 MiB is rewritten. Any other body is refused with 400 (`EDG-PLG-010`): another content type, invalid JSON, a JSON array or scalar, or a body over 1 MiB. Kong passes those on untouched, which would let a client skip a `remove` of a secret field just by changing the content type. An empty body with no content type passes.
- `replace.uri`: the upstream path. The query string is kept.
- `http_method`: when the method changes to GET, HEAD or TRACE, a form body with a Content-Length of at most 1 MiB moves into the query string, as in Kong. Any other body is dropped, including a chunked form body (Kong would move that too).
- **Templates:** `$(headers.name)`, `$(headers['name'])`, `$(query_params.name)`, `$(uri_captures.name)` and `$(uri_captures[1])`.

## Unsupported Kong fields

- Lua expressions in templates: only the simple references above.
- Multipart bodies, and bodies over 1 MiB: with `body` operations configured, both are refused (400) rather than passed on.
- Nested JSON paths: only top-level keys.

## Differences from Kong

- **Appending to a non-string JSON value:** Kong's `append_value` replaces a number or boolean with a one-element array. Edgway keeps the existing value: `[existing, new]`.
