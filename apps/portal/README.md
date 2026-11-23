# @edgway/portal

The developer portal: a [Zudoku](https://zudoku.dev) site plus a small Worker (`src/worker.ts`) whose `/api` lets signed-in developers manage their own API keys. Deploying it is covered in [docs/deploy.md](../../docs/deploy.md).

## Pages

- `/`: a public landing page.
- `/reference`: the public API reference, only when the site is built with an OpenAPI document (below).
- `/settings/api-keys`: the developer's keys (sign-in required). Each key is its own entry with a name. A key is shown in full only right after it is created or rotated. Rotating a key gives that key a new value: the old value stops working within about a second, and the developer's other keys are untouched.

## Build variables

The site is built by `zudoku build` (run by `wrangler deploy`). It reads these from the environment:

| Variable | Required | What it is |
| --- | --- | --- |
| `ZUDOKU_PUBLIC_OIDC_ISSUER` | yes | The identity provider's issuer URL. |
| `ZUDOKU_PUBLIC_OIDC_CLIENT_ID` | yes | The portal's client id at that provider (a single-page application, callback `https://<portal>/oauth/callback`). |
| `ZUDOKU_PUBLIC_PORTAL_OPENAPI` | no | Path to an OpenAPI document (JSON or YAML) for the API reference, for example the API your gateway serves. Without it the portal has no reference and the landing page doesn't link to one. |
| `ZUDOKU_PUBLIC_GATEWAY_URL` | no | The gateway's address, for example `https://api.example.com/`. The landing page's first-request example (`curl`) uses it; without it the example shows a placeholder. |

`ZUDOKU_PUBLIC_*` values are compiled into the site, so they are public. Never put a secret in one.

## Worker variables

Set these in `wrangler.jsonc` `vars`:

- `OIDC_ISSUER` and `OIDC_AUDIENCE`: the issuer, and the audience the provider puts in access tokens (often the client id). With either one empty, the key API refuses every request.
- `WORKSPACE_ID` (optional): the admin workspace the developers' consumers live in.
- `PORTAL_CONNECT_SRC` (optional): extra origins the portal's pages may call, space- or comma-separated. The API reference's playground sends requests from the browser, so set this to your gateway's origin (for example `https://api.example.com`) when you publish a reference. Without it the playground's requests are blocked.
- `PORTAL_ALLOWED_EMAIL_DOMAINS` (optional): the email domains that may sign up, space- or comma-separated. When set, a developer gets a consumer and keys only with a verified email (from the provider's userinfo) at one of them; an email the provider hasn't verified gets 403 (`portal_email_unverified`), anyone else 403 (`portal_not_allowed`). The portal turns each refusal (these, `portal_blocked` and the key limit) into a message saying what happened and what to do, and never names the allowed domains. Set it when anyone can register with your provider. Empty: anyone the provider signs in.
- `CF_ACCOUNT_ID` (optional), with the secret `AE_API_TOKEN` (an API token with Account Analytics: Read): the API keys page then shows each developer their own requests and server errors per day for the last 7 days, from the gateway's Analytics Engine data. Without them, the usage panel is hidden.

Every portal response carries a Content-Security-Policy. Pages may connect to:
- the portal itself;
- the identity provider: its issuer and every endpoint its discovery document names, even on other hosts, as with Google;
- the origins in `PORTAL_CONNECT_SRC`.

The Worker reads the provider's discovery document. On a developer's first visit it asks the provider's userinfo endpoint for their email and name, and labels their consumer with a display name, the verified email or else the name, so admins can find the developer. The display name is never the consumer's username.
