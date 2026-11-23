# Security policy

Edgway is an API gateway: it authenticates requests, holds credentials and signs the config it serves. Security reports are welcome and are handled privately.

## Supported versions

Edgway is pre-1.0. Only the latest released minor version gets security fixes. Once 1.0 ships, the current and the previous minor version will be supported.

| Version | Supported |
| --- | --- |
| Latest 0.x release | Yes |
| Older 0.x releases | No: upgrade to the latest |
| Unreleased `main` | Best effort |

## Reporting a vulnerability

**Don't open a public issue, discussion or pull request for a vulnerability.**

Report it privately through GitHub's security advisories:

1. Go to <https://github.com/scoobydrew83/edgway/security/advisories/new>. This is the **Security** tab, then **Report a vulnerability**.
2. Describe the issue and the affected component (gateway, admin API, Kong-compatible Admin API, admin UI, portal, CLI, a plugin or Terraform), the version or commit, and steps to reproduce.

Please give us a reasonable time to fix the issue before you disclose it. Test only against your own deployment. Don't touch other people's data, and don't degrade a service you don't own.

## What to expect

| Step | Target |
| --- | --- |
| We acknowledge your report | Within 3 business days |
| First assessment (we confirm the issue, rate its severity and ask any questions) | Within 7 days |
| Fix released for a critical or high severity issue | Within 30 days |
| Fix released for a medium or low severity issue | In the next regular release |

We'll keep you updated on progress and agree a disclosure date with you. Once a fix ships, we publish a GitHub security advisory, crediting you unless you'd rather we didn't. A CVE is requested where one applies.

## Trust boundaries

What each role and component can do, so you can judge a report (and your own deployment) against it:

- **The `editor` role runs code on all gateway traffic.** Editors can upload sandboxed plugins. A sandboxed plugin runs in its own isolate with no network and no bindings, and it can't change the client IP, the consumer identity headers or the request body. But it does see every request header of the routes it is attached to (including `Authorization` and `Cookie`, unless an earlier plugin hides them), it can set response headers, and its isolate is reused across requests, so it can keep state between them. Grant `editor` only to people you would trust with your gateway's traffic.
- **Portal sign-up follows your identity provider.** Anyone your provider signs in to the developer portal gets a consumer and API keys, and those keys pass key-auth on every route that has no `acl` plugin. If anyone can register with your provider, set `PORTAL_ALLOWED_EMAIL_DOMAINS` (see `docs/deploy.md`), and put `acl` on routes that only some consumers should reach.
- **The Kong-compatible Admin API is outside Cloudflare Access.** decK and Terraform authenticate with `Kong-Admin-Token` alone, and the mount has no rate limit of its own. Use long random tokens (`openssl rand -hex 32`), give each the smallest role it needs, and rotate them like any other secret.
- **The signed config snapshot in KV holds credentials.** It carries key-auth key hashes (SHA-256), basic-auth password hashes (Kong's SHA-1 format, so decK configs keep working) and any plugin secret (an OIDC `client_secret`, an ai-proxy key) you store as plain text rather than as a vault reference. jwt secrets and certificate keys are always vault references: the admin refuses anything else. Anyone who can read the `CONFIG_KV` namespace can read them: restrict who has access to your Cloudflare account, and prefer vault references (`{vault://env/...}`) for secrets.

## Hardening checklist

Defaults follow Kong 3.9, and some of them are permissive. Before production, check:

- **proxy-cache:** with `cache_control` off (the default), a response from an upstream that checks its own bearer tokens can be cached and served to another caller on the same URL. Turn `cache_control` on, or don't cache routes whose upstream authenticates requests itself. (Responses with `Set-Cookie` are never stored, and a request with a `Cookie` and no consumer bypasses the cache.)
- **cors:** `credentials: true` with no origins or `*` reflects any `Origin`, so any site can read credentialed responses. List your origins.
- **request-transformer:** a `replace.uri` template built from client input (`$(headers.x)`, `$(query_params.x)`) lets the client choose the upstream path, `..` segments included. Template only values you trust.
- **openid-connect:** `hide_credentials` removes a bearer token sent in the `Authorization` header or the query string, not one sent in a cookie, and the session cookie is still forwarded upstream.
- **http-log:** `Authorization`, `Cookie`, `Set-Cookie` and the credential headers and query parameters of the route's auth plugins are redacted, but a secret that request-transformer adds under another header is logged as sent. Don't inject secrets with request-transformer on routes that log to an endpoint you don't control.
- **X-Forwarded-For:** like Kong, the gateway appends the client IP to the `X-Forwarded-For` the client sent. Upstreams should trust `X-Real-IP` or the last `X-Forwarded-For` entry, not the first.
- **Outbound URLs:** editors choose where the gateway sends requests (service hosts, http-log's `http_endpoint`, ai-proxy's `upstream_url`, an OIDC `issuer`). Cloudflare Workers can't reach private addresses, but they can reach any public one.
- **Content-Security-Policy:** the admin UI allows `'unsafe-eval'` (its schema forms compile validators at run time) and the portal allows `'unsafe-inline'` scripts (Zudoku's inline bootstrap). Keep both behind the hostnames you intend: the admin UI behind Access.

## Scope

In scope: the code in this repository and the default configuration it deploys, including:
- the gateway (`apps/gateway`);
- the admin and its APIs (`apps/admin`);
- the admin UI (`apps/ui`);
- the developer portal (`apps/portal`);
- the CLI (`apps/cli`);
- the packages, the first-party plugins and the Terraform module.

Out of scope:
- vulnerabilities in Cloudflare's platform: report those to Cloudflare;
- vulnerabilities in third-party dependencies that don't affect Edgway: report those upstream;
- issues that need a compromised Cloudflare account or admin credentials;
- missing hardening on a deployment that changed Edgway's defaults.
