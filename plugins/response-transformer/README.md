# @edgway/plugin-response-transformer

Kong's [response-transformer](https://developer.konghq.com/plugins/response-transformer/) plugin (priority 800) for Edgway. It can also be used as plain Hono middleware:

```ts
import transformer from "@edgway/plugin-response-transformer";

app.use(transformer.middleware({ remove: { headers: ["server"] }, add: { json: ["version:2"], json_types: ["number"] } }));
```

## Supported config

- `remove`, `rename`, `replace`, `add`, `append` on `headers`, in Kong's order.
- The same operations on `json`: top-level keys of a JSON response (`application/json` or `+json`).
  - `json_types` casts each value to `boolean`, `number` or `string`.
  - `append` turns the key into an array.
  - When the body changes, `Content-Length` is removed.
- **Body size:** a JSON body is rewritten when it is at most 1 MiB. Bigger bodies, non-JSON bodies and invalid JSON stream through untouched, so the plugin never buffers more than that.

## Unsupported Kong fields

- Nested JSON paths: only top-level keys.
- JSON bodies over 1 MiB: they pass through untouched.
