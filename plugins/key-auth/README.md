# @edgway/plugin-key-auth

Kong's [key-auth](https://developer.konghq.com/plugins/key-auth/) plugin (priority 1250) for Edgway, built on `hono/bearer-auth`. It can also be used as plain Hono middleware:

```ts
import keyAuth, { setKeyAuthStore } from "@edgway/plugin-key-auth";

app.use((c, next) => (setKeyAuthStore(c, store), next()));
app.use(keyAuth.middleware({ key_names: ["apikey"], hide_credentials: true }));
```

The gateway supplies a `KeyAuthStore`, which looks up credentials by the SHA-256 hash of the key and consumers by id or username. Keys are never stored raw. `generateKey()` creates a new key with nanoid; store `sha256Hex(key)` and `keyDisplayPrefix(key)`, and show the key only once.

## Supported config

- `key_names`: each name is tried in order, first as a header, then as a query parameter.
- `key_in_header`, `key_in_query`
- `hide_credentials`: the key header or query parameter is removed before the request goes upstream.
- `anonymous`: a consumer id or username.
- `realm`: sent in `WWW-Authenticate: Key realm="…"`.
- `run_on_preflight`

Responses follow Kong's semantics:

| Case | Status | Code | Message |
| --- | --- | --- | --- |
| No key | 401 | `EDG-AUTH-002` | "No API key found in request" |
| Two keys in the query string | 401 | `EDG-AUTH-003` | "Duplicate API key found" |
| Unknown or expired key | 401 | `EDG-AUTH-004` | "Unauthorized" |

Every one of these also carries `WWW-Authenticate: Key` (plus the realm, when one is set). Upstream requests receive `X-Consumer-ID`, `X-Consumer-Custom-ID`, `X-Consumer-Username`, `X-Credential-Identifier` and, for the anonymous consumer, `X-Anonymous-Consumer: true`.

## Unsupported Kong fields

The admin rejects these fields at validation time:

- `key_in_body`: reading the body in `access` would buffer it, and Edgway streams bodies.

## Differences from Kong

- **Repeated header:** a key header sent twice arrives joined (`a, b`) by the Fetch API. It is checked as one key, so it gets 401 Unauthorized rather than "Duplicate API key found".
- **Multiple authentication plugins:** with `anonymous` set, Kong skips the plugin when an earlier auth plugin already found a credential ("logical OR"). Edgway has no shared credential on the context yet, so the plugin always runs.
