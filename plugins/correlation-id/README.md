# @edgway/plugin-correlation-id

Kong's [correlation-id](https://developer.konghq.com/plugins/correlation-id/) plugin (priority 100001) for Edgway, built on `hono/request-id`. It can also be used as plain Hono middleware; the id is then available as Hono's `requestId` variable:

```ts
import correlationId from "@edgway/plugin-correlation-id";

app.use(correlationId.middleware({ header_name: "X-Request-ID", echo_downstream: true }));
```

## Supported config

- `header_name` (default `Kong-Request-ID`): an id the request already carries in this header is kept as it is, Kong's `uuid#counter` form included. Otherwise one is generated and sent upstream in the same header.
- `generator`:
  - `uuid`: a random v4 UUID;
  - `uuid#counter` (the default): the isolate's UUID, `#`, then a counter;
  - `tracker`: Cloudflare colo, isolate UUID, counter and time.
- `echo_downstream`: the response carries the id too.

## Differences from Kong

- **tracker.** Kong builds it from nginx connection details (server address, port, worker pid, connection number). Workers have none of these, so Edgway uses the Cloudflare colo, the isolate's UUID, a counter and the time.
- **Counter scope.** The `uuid#counter` counter is per isolate, where Kong's is per nginx worker.
