# @edgway/plugin-jwt

Kong's [jwt](https://developer.konghq.com/plugins/jwt/) plugin (priority 1450) for Edgway, built on `jose`. It can also be used as plain Hono middleware:

```ts
import jwt, { setJwtStore } from "@edgway/plugin-jwt";

app.use((c, next) => (setJwtStore(c, store), next()));
app.use(jwt.middleware({ claims_to_verify: ["exp"] }));
```

The gateway supplies a `JwtStore`. It looks up Kong's `jwt_secrets` rows by `key`, and consumers by id or username. HMAC secrets must already be resolved when they reach the store; resolving `{vault://…}` references is the gateway's job.

## Supported config

- `uri_param_names`, `cookie_names`, `header_names` (`Bearer <token>`): Kong's lookup order. Several different tokens are rejected.
- `key_claim_name`: looked up in the claims first, then in the protected header.
- `claims_to_verify` (`exp`, `nbf`): these are checked only when listed, as in Kong. jose's `jwtVerify` would always check them, so the signature is verified with `compactVerify` instead.
- `maximum_expiration`, `anonymous`, `realm`, `run_on_preflight`.
- `secret_is_base64`: the secret is decoded as base64url, with or without padding, as Kong does.
- Credential algorithms: HS256/384/512 (secret), plus RS*, ES*, PS* and EdDSA (PEM public key in `rsa_public_key`).

Every failure is a 401. With no token, the challenge is `WWW-Authenticate: Bearer` (plus the realm, when one is set). A token that was sent but rejected adds `error="invalid_token"`, as Kong does. Codes run from EDG-AUTH-004 to EDG-AUTH-017:

| Code | Message |
| --- | --- |
| EDG-AUTH-004 | "Unauthorized" (no token) |
| EDG-AUTH-005 | "Multiple tokens provided" |
| EDG-AUTH-006 | "Bad token" |
| EDG-AUTH-007, EDG-AUTH-008 | missing or invalid key claim |
| EDG-AUTH-009 | no credentials for the key claim |
| EDG-AUTH-010 | "Invalid algorithm" |
| EDG-AUTH-011 | "Invalid key/secret" |
| EDG-AUTH-012 | "Invalid signature" |
| EDG-AUTH-013 | expired |
| EDG-AUTH-014 | not valid yet |
| EDG-AUTH-015 | exceeds `maximum_expiration` |
| EDG-AUTH-016 | claim not a number |
| EDG-AUTH-017 | the credential's consumer no longer exists |

Upstream requests receive Kong's consumer headers: `X-Consumer-ID`, `X-Consumer-Custom-ID`, `X-Consumer-Username`, `X-Credential-Identifier` (the credential's `key`, as in Kong's jwt) and `X-Anonymous-Consumer`.

## Differences from Kong

- **Error messages.** Kong builds some messages with the claim name in them, such as "No mandatory 'iss' in claims". Edgway keeps the titles fixed and puts the claim name in the problem's `claim` member. For claim failures Kong returns a table (`{"exp": "token expired"}`); Edgway returns one code per failure.
- **Multiple authentication plugins.** Kong's "logical OR" skip for several auth plugins is not implemented yet. See the key-auth README.
