# @edgway/plugin-basic-auth

Kong's [basic-auth](https://developer.konghq.com/plugins/basic-auth/) plugin (priority 1100) for Edgway, built on `hono/basic-auth`. It can also be used as plain Hono middleware:

```ts
import basicAuth, { setBasicAuthStore } from "@edgway/plugin-basic-auth";

app.use((c, next) => (setBasicAuthStore(c, store), next()));
app.use(basicAuth.middleware({ hide_credentials: true }));
```

The gateway supplies a `BasicAuthStore`. It looks up Kong's `basicauth_credentials` rows by username, and consumers by id or username. Passwords are checked against Kong's stored format, `sha1(password .. consumer_id)` as hex, so passwords imported with decK keep working. `hashPassword(password, consumerId)` produces that format.

## Supported config

- `realm`: the challenge is `WWW-Authenticate: Basic realm="<realm>"`. Kong's default realm is `service`.
- `hide_credentials`: removes `Authorization` and `Proxy-Authorization` before the request goes upstream.
- `anonymous`: a consumer id or username.

Kong reads `Proxy-Authorization` first, then `Authorization`. Every failure returns 401 "Unauthorized" (`EDG-AUTH-004`) with the realm challenge, or uses the `anonymous` consumer when one is set.

Upstream requests receive `X-Consumer-ID`, `X-Consumer-Custom-ID`, `X-Consumer-Username`, `X-Credential-Identifier` (the credential's username, as in Kong's basic-auth) and `X-Anonymous-Consumer`.

## Differences from Kong

- **Multiple authentication plugins.** Kong's "logical OR" skip for several auth plugins is not implemented yet (see the key-auth README).
