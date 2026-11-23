# @edgway/plugin-openid-connect

Kong's [openid-connect](https://developer.konghq.com/plugins/openid-connect/) plugin (priority 1050) for Edgway. Kong's plugin is Enterprise; its schema is public, and Edgway implements the two flows most gateways need:

- **bearer**: `openid-client` discovers the issuer, and Hono's JWK verifier (the engine of `hono/jwk`) checks the token against the issuer's `jwks_uri`. Cloudflare caches the JWKS subrequest for `cache_ttl`.
- **session** and **authorization_code**: `@hono/oidc-auth` runs the login redirect (PKCE, state, nonce), the callback at `redirect_uri` and the signed session cookie. This needs `client_id`, `client_secret`, `session_secret` (32 or more characters) and `redirect_uri`. The IdP must advertise `scopes_supported`.

This is an independent implementation of Kong's Enterprise plugin's public configuration schema (vendored from Kong's MIT-licensed schemas). It contains no Kong code, and it is not Kong's plugin, nor affiliated with or endorsed by Kong Inc. (see the repository's NOTICE).

```ts
import oidc, { setOidcStore } from "@edgway/plugin-openid-connect";

app.use((c, next) => (setOidcStore(c, store), next()));
app.use(oidc.middleware({ issuer: "https://idp.example", auth_methods: ["bearer"] }));
```

The gateway supplies an `OidcStore` (consumer by `id`, `username` or `custom_id`), which is needed when `consumer_claim` or `anonymous` is set. Secrets arrive resolved; resolving vault references is the gateway's job.

## Supported config

- `issuer` (with or without `/.well-known/openid-configuration`), `issuers_allowed`
- `auth_methods`: `bearer`, `session`, `authorization_code`
- `bearer_token_param_type`: `header`, `query` (`access_token`), `cookie` (`bearer_token_cookie_name`)
- `verify_claims` (`exp`, `nbf`, issuer, `audience`), `audience`, `audience_claim`
- `audience_required`, `scopes_required`, `groups_required`, `roles_required`, with the matching `*_claim`. As in Kong, entries are alternatives, and the space-separated values within one entry are all required. Unmet → 403.
- `consumer_claim`, `consumer_by`, `consumer_optional`, `authenticated_groups_claim` (sets the consumer's groups for acl)
- `upstream_access_token_header`, `upstream_headers_claims` + `upstream_headers_names`
- `anonymous` (on 401 only), `hide_credentials`, `run_on_preflight`
- `unauthorized_error_message`, `forbidden_error_message` (returned as the problem `detail`)
- `client_id`, `client_secret`, `session_secret`, `redirect_uri`, `scopes`, `session_cookie_name`, `session_cookie_path`, `session_cookie_domain`, `session_absolute_timeout`

Failures:

| Case | Status | Code | Challenge |
| --- | --- | --- | --- |
| Missing or invalid token | 401 | EDG-AUTH-004 | `WWW-Authenticate: Bearer realm="<host>"`, plus `error="invalid_token"` when a token was sent |
| Unmet requirement or unknown consumer | 403 | EDG-AUTH-018 | none |
| Discovery failure | 500 | | |

## Unsupported Kong fields

The admin rejects these at validation time:

- **Auth methods:** `client_credentials`, `password`, `introspection`, `kong_oauth2`, `refresh_token`, `userinfo`. Also token exchange, DPoP, mTLS proof of possession, PAR and JAR.
- **Token sources and verification:** `bearer_token_param_type: body` (reading the body would buffer it), `leeway`, `verify_signature: false` and `enable_hs_signatures` (signatures are always verified with JWKS keys), `extra_jwks_uris`.
- **Sessions:** Redis or memcached session storage, `session_remember*`, `logout_*`, `login_*` and `end_session_endpoint`.
- **Upstream and downstream headers:** `upstream_id_token_*`, `upstream_user_info_*`, `upstream_introspection_*` and all `downstream_*` headers. The session flow sends no access token upstream.
- **Everything else:** `display_errors`, `expose_error_code`, the `cache_*` settings other than `cache_ttl`, the proxy settings and `cluster_cache_*`.

## Differences from Kong

- **authenticated_groups_claim:** applied only when a consumer is mapped. Edgway has no consumer-less authenticated groups yet.
- **Multiple authentication plugins:** Kong's "logical OR" skip is not implemented yet (see the key-auth README).
