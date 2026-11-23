# Deploying Edgway

Edgway is three Workers on your Cloudflare account:

| Worker | Holds | Bindings |
| --- | --- | --- |
| `edgway-admin` | The admin API (`/api/v1`) and the Kong-compatible mount for decK and Terraform | D1 `edgway-admin` (the staged config), KV `CONFIG_KV`, Durable Objects `ConfigVersion` and `PortalPublisher`, Service Binding `GATEWAY` (the route tester's way to the gateway) |
| `edgway-gateway` | The data plane | KV `CONFIG_KV` (the same namespace), Durable Object `RateLimitCounter`, Service Binding `CONFIG_VERSION` to the admin's read-only `ConfigVersionReader` (deployed after the admin) |
| `edgway-portal` | The developer portal (Zudoku) and its self-serve key API | D1 `edgway-admin` (the same one), Service Binding `ADMIN` to the admin's `PortalPublish` entrypoint |

One command deploys all three: `pnpm run deploy`, which builds the `edgway` CLI and runs `edgway deploy` (the same command works from any project with an `edgway.config.ts`). Every step is idempotent, so re-running it is a redeploy:

1. It finds or creates the KV namespace `edgway-config` and the D1 database `edgway-admin`, and writes their ids into the three `wrangler.jsonc` files with wrangler's own config API. It doesn't rely on wrangler's automatic provisioning for two reasons: that would give each Worker its own KV namespace, and on a first deploy it would create D1 during `wrangler deploy`, so the admin would go live before its migrations ran.
2. It applies the admin's D1 migrations remotely.
3. It deploys the admin, then the gateway, then the portal, then the admin again. The admin and the gateway bind each other (the gateway reads the live version through the admin's `ConfigVersionReader`; the admin's route tester calls the gateway through `GATEWAY`), and a Worker can't bind one that doesn't exist yet, so the first admin deploy leaves `GATEWAY` out and the last one adds it.
4. On the first deploy, it generates two Ed25519 key pairs, both as Worker secrets:
   - the snapshot pair: the admin's `CONFIG_SIGNING_KEY` and the gateway's `CONFIG_PUBLIC_KEY`;
   - the route tester's trace pair: the admin's `TRACE_SIGNING_KEY` and the gateway's `TRACE_PUBLIC_KEY`.

   Only the admin signs. The portal holds no key: it asks the admin, over its `ADMIN` binding, to publish developers' keys. A pair is generated only when none of its secrets exist.

`pnpm run deploy -- --dry-run` bundles and checks the three Workers and touches nothing remote.

The portal's site is built during its deploy, and its build reads the identity provider from `ZUDOKU_PUBLIC_OIDC_ISSUER` and `ZUDOKU_PUBLIC_OIDC_CLIENT_ID`. Set both in the environment that runs `pnpm run deploy` (Workers Builds: the build's environment variables).

## Option A: the Deploy to Cloudflare button

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/scoobydrew83/edgway)

The button copies this repository into your GitHub or GitLab account and connects it to Workers Builds. Cloudflare's button deploys one Worker per repository on its own, so Edgway gives it a stand-in: the root `wrangler.jsonc` names the admin Worker and declares no bindings, and the build runs the root deploy script, which deploys all three Workers from their own configs.

1. Click the button and sign in to Cloudflare.
2. Name the new repository. The button fills the build settings from the root `package.json`:
   - **Build command:** it suggests `pnpm run build`. Clear it: the deploy script builds what it deploys, and the full build also builds the docs site.
   - **Deploy command:** `pnpm run deploy`. Keep it.
   - The button provisions nothing itself (the root config has no bindings); step 1 above creates the KV namespace and the D1 database.
3. Set `ZUDOKU_PUBLIC_OIDC_ISSUER` and `ZUDOKU_PUBLIC_OIDC_CLIENT_ID` as build variables if you want the portal's sign-in now (you can add them later and redeploy).
4. Create and deploy. The build log shows the four steps above. Each Worker's URL is printed at the end of its `wrangler deploy` step.
5. Every later push to the production branch redeploys all three Workers.

The Worker the build is connected to (whatever name the dashboard shows) only anchors the build. Workers Builds tells wrangler to deploy under that name (`WRANGLER_CI_OVERRIDE_NAME`, checked against `WRANGLER_CI_MATCH_TAG`), which would put all three Workers under one name, so `edgway deploy` runs wrangler without both variables and each Worker deploys under the name in its own config. If Workers Builds opens a pull request to fix a "config name mismatch" in the root `wrangler.jsonc`, close it: the root config's name doesn't decide what is deployed.

If you connect the repository yourself instead of using the button (Workers & Pages, then Import a repository), use the same settings: an empty build command and `pnpm run deploy` as the deploy command.

This path has not yet been run end to end on a fresh account (the timed walkthrough below). Until it has, Option B is the tested one.

## Option B: from a terminal

```sh
pnpm install
pnpm --filter @edgway/admin exec wrangler login   # or set CLOUDFLARE_API_TOKEN
pnpm run deploy
```

The ids that step 1 writes into `apps/admin/wrangler.jsonc`, `apps/gateway/wrangler.jsonc` and `apps/portal/wrangler.jsonc` belong to your account. Commit them in your copy of the repository, running `pnpm format` first, because wrangler's config patcher re-indents the file.

## After the first deploy

The admin fails closed until Cloudflare Access is set up. Every API call answers 401.

1. **Cloudflare Access.** In Zero Trust, add a self-hosted application on the admin Worker's hostname with two paths, `/api/v1` and `/ui` (the native API and the admin UI). Copy its **AUD tag**. Leave the rest of the hostname outside Access: the Kong-compatible mount at the root is what decK and Terraform call, and it authenticates every request itself with `Kong-Admin-Token` (step 3). An admin that sees no Access token on `/api/v1` answers 401, so a missing path in the application fails closed. To check, open the admin's root (`/`) without signing in: it should answer 401 from the admin, not redirect to `<team>.cloudflareaccess.com`. A redirect means the application covers the whole hostname, so decK and Terraform can't reach the Kong mount; limit its paths to `/api/v1` and `/ui`.
2. **Admin variables.** On the deployed admin Worker (dashboard: Workers & Pages, `edgway-admin`, Settings, Variables and Secrets, as plain text), set:
   - `ACCESS_TEAM`: your team name, the `<team>` in `<team>.cloudflareaccess.com`;
   - `ACCESS_AUD`: the AUD tag;
   - `ADMIN_ROLES`: JSON mapping identities to roles (`viewer`, `editor`, `publisher` or `owner`), for example `{"you@example.com": "owner", "<service token client id>": "publisher"}`. Use straight quotes: a map that isn't valid JSON gives no one a role.

   They take effect when you save. They aren't in `apps/admin/wrangler.jsonc`, which sets `keep_vars`, so later deploys keep them. Workers Builds deploys without asking. A terminal deploy after you've edited variables in the dashboard first warns that the Worker's remote configuration differs from your local one and lists these variables as removed. Answer **yes**: `keep_vars` keeps them. If you answer no, the admin isn't deployed, and don't accept wrangler's next offer to copy the remote values into `wrangler.jsonc`. They are public values, so plain-text variables, not secrets. An identity that signs in but has no role gets 403 `EDG-ADM-001` with the detail `ADMIN_ROLES`. Locally, set them in `apps/admin/.dev.vars`.
3. **decK and Terraform (optional).** The Kong-compatible mount at the admin's root authenticates the `Kong-Admin-Token` header against the `KONG_ADMIN_TOKENS` secret, a JSON map of `sha256(token)` to role:

   ```sh
   TOKEN=$(openssl rand -hex 32)
   HASH=$(printf '%s' "$TOKEN" | sha256sum | cut -d' ' -f1)
   echo "{\"$HASH\":\"publisher\"}" | pnpm --filter @edgway/admin exec wrangler secret put KONG_ADMIN_TOKENS
   ```

   The mount is outside the Access application (step 1), so these tools need only the token. A request without a valid one answers 401.
4. **Developer portal.** The portal is for your API's developers, so its hostname stays **outside** Cloudflare Access. Developers sign in with OpenID Connect:
   - Register the portal as a single-page application with your identity provider (any OIDC provider, or Better Auth's). Its callback URL is `https://<portal>/oauth/callback`.
   - In `apps/portal/wrangler.jsonc`, set `OIDC_ISSUER` (the issuer URL) and `OIDC_AUDIENCE` (the audience the provider puts in access tokens, often the client id). Both are required: with either empty, the key API refuses every request, so a token your provider issued to another application is never accepted. Set `ZUDOKU_PUBLIC_OIDC_ISSUER` and `ZUDOKU_PUBLIC_OIDC_CLIENT_ID` for the build, and optionally `ZUDOKU_PUBLIC_PORTAL_OPENAPI` (an OpenAPI document for the portal's public API reference; see `apps/portal/README.md`). Then redeploy.

   A signed-in developer gets a consumer of their own, matched on their OIDC subject in a column only the portal sets (never `custom_id`, so a developer can't take over a consumer an admin made), and manages only that consumer's API keys: up to five, each with a name. Rolling a key gives that key a new value and leaves the others working. On first sign-in the portal asks your provider's userinfo endpoint for the developer's email and name, so admins see the developer by email (or name) rather than by OIDC subject. Each new, rolled or deleted key goes live within about a second: the portal hands the change to the admin, which gathers developers' changes and publishes them together once a second (the current configuration plus those keys, never other staged edits).

   **Who may sign up.** Anyone your provider signs in gets a consumer and API keys, and those keys work on every route with key-auth and no `acl` plugin. If anyone can register with your provider (a social login, or open sign-up), set `PORTAL_ALLOWED_EMAIL_DOMAINS` in `apps/portal/wrangler.jsonc` to the email domains that may sign up, space- or comma-separated (e.g. `"example.com partner.example"`). The portal then asks the provider's userinfo endpoint before making a consumer, and refuses (403, `portal_not_allowed`) anyone without a verified email at a listed domain, including developers who signed up before you set it. Either way, put `acl` on routes that only some consumers should reach.
5. **First configuration.** Use any of these:
   - `deck gateway sync kong.yaml --kong-addr https://<admin> --headers "Kong-Admin-Token:$TOKEN"`, then `curl -X POST -H "Kong-Admin-Token: $TOKEN" https://<admin>/edgway/publish`;
   - the CLI against the deployed admin: `edgway import-deck kong.yaml --remote --admin-url https://<admin> --kong-token "$TOKEN"` (through the Kong-compatible mount; `EDGWAY_KONG_TOKEN` also works), then `edgway diff` and `edgway publish`. Without `--remote`, `import-deck` writes to the admin's local D1, for `wrangler dev`.

     `diff`, `publish`, `versions` and `rollback <version>` go through the native API, behind Access. Use a service token (`CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET`), or `--token "$(cloudflared access token -app https://<admin>)"`: the CLI sends a deployed admin `cf-access-token`, and a local one the assertion header. `edgway diff --exit-code` fails a CI job while changes are unpublished, and `--json` prints any of these as JSON;
   - the admin API (`/api/v1/docs`).

   The gateway serves the routes within about a second of the publish: it reads the live version from the admin's `ConfigVersion` Durable Object, through a read-only entrypoint (it can never move the version). Before the first publish it answers 503 (`EDG-CFG-004`). The `ConfigVersion` Durable Object is the only source of the live version (KV's `config:current` pointer isn't signed), so after upgrading from a release without it, publish once to make the current config live again.

## Optional setup

### The overview dashboard (analytics)

The gateway writes one data point per request to the Workers Analytics Engine dataset `edgway_requests` (its `ANALYTICS` binding, created on first use). The admin UI's overview reads it back through the Analytics Engine SQL API, which needs two values on the admin:

- `CF_ACCOUNT_ID` in `apps/admin/wrangler.jsonc` `vars`: your account id;
- the secret `AE_API_TOKEN`: an API token with **Account Analytics: Read** (`wrangler secret put AE_API_TOKEN --config apps/admin/wrangler.jsonc`).

Without both, the overview says analytics isn't set up. With them and no traffic yet, it says there are no requests in the period.

The overview shows, over the last 24 hours:
- requests, server errors and mean latency per hour;
- p50 and p99 latency;
- the busiest routes and consumers.

It always shows the live config version and the last publish, which come from the admin itself, with or without analytics.

**Per-plugin timing.** The gateway also writes one data point per plugin per phase to a second dataset, `edgway_plugins` (its `PLUGIN_ANALYTICS` binding), at most 50 per request. Each point holds the plugin's name and id, the phase, the outcome (`ok`, `short-circuit`, `error`, `timeout`, `circuit-open`), the route and the duration. Query it with the same SQL API, for example the slowest plugins over a day:

```sql
SELECT blob1 AS plugin, blob2 AS phase,
  quantileExactWeighted(0.99)(double1, _sample_interval) AS p99_ms
FROM edgway_plugins
WHERE timestamp > NOW() - INTERVAL '1' DAY
GROUP BY plugin, phase ORDER BY p99_ms DESC
```

**Developers' usage in the portal.** The portal's API keys page shows each developer their own requests and server errors per day over the last 7 days. Give the portal the same two values, in `apps/portal/wrangler.jsonc` `vars` and as its own secret (`wrangler secret put AE_API_TOKEN --config apps/portal/wrangler.jsonc`). The portal only ever queries the signed-in developer's consumer, and keeps each answer for a minute. Without the values, the panel isn't shown.

### Traces and OpenTelemetry export

Workers tracing records each gateway request as a trace:
- Cloudflare's own spans: the fetch handler, KV reads, Durable Object and Service Binding calls, subrequests;
- Edgway's spans: `edgway.phase.<phase>` for each plugin phase that runs (`rewrite`, `access`, `header_filter`, `body_filter`, `log`), and `edgway.upstream` for the upstream call.

The spans carry the phase, route and service ids. `rewrite` and `access` run as middleware, so their spans enclose the phases and the upstream call that follow.

Traces are off by default. To turn them on, and to export them to any OpenTelemetry (OTLP) backend such as Honeycomb, Grafana Cloud or Axiom:

1. In the Cloudflare dashboard, go to **Observability** > **Destinations** and add a *Traces* destination with your provider's OTLP endpoint and authentication header.
2. In `apps/gateway/wrangler.jsonc`, set:

   ```jsonc
   "observability": {
     "enabled": true,
     "traces": {
       "enabled": true,
       "head_sampling_rate": 0.05,
       "destinations": ["<destination name>"],
       "persist": false
     }
   }
   ```

3. Deploy.

`head_sampling_rate` is the share of requests traced (here 5%). `persist: false` sends traces only to your destination and doesn't keep them in Cloudflare.

**Budget.** Workers traces and logs are billed under Cloudflare Observability pricing from 2026-12-01; check Cloudflare's [Observability pricing](https://developers.cloudflare.com/observability/pricing/) for current figures. At the time of writing:
- the Workers Paid plan includes 50 GB of ingestion and 10 GB-month of storage per billing cycle, then charges $0.25 per GB ingested and $0.10 per GB-month stored;
- the Free plan allows 0.5 GB a day.

Only traces Cloudflare keeps (`persist`, the default) count toward these meters: their ingestion, and their storage over the 7-day retention. With `persist: false`, traces exported to your destination aren't billed by Cloudflare, and only your OTLP backend's pricing applies.

For persisted traces, size the sample rate from your traffic. A traced gateway request is:
- the handler span;
- Edgway's phase and upstream spans;
- one span per KV, Durable Object or subrequest call.

That comes to roughly 2–5 KB per request (an estimate; check your first days' usage under **Billable Usage**). At a 5% sample, 100 million requests a month is about 5 million traces, around 10–25 GB of ingestion, within the Paid plan's 50 GB.

The `edgway.upstream` span ends when the upstream's response headers arrive; streaming the body to the client isn't part of it.

### The route tester

The admin's route tester sends requests to the gateway over the `GATEWAY` Service Binding, so it needs no setup. Set `GATEWAY_URL` in the admin's `vars` only if your routes match on a host: the tester then sends that host. It is also the tester's way in when there is no binding (local runs).

### http-log retries

http-log sends each entry once. To retry failed deliveries, give the gateway a Cloudflare Queue:

```sh
pnpm --filter @edgway/gateway exec wrangler queues create edgway-http-log-retry
```

Then uncomment the `queues` block in `apps/gateway/wrangler.jsonc` (producer `HTTP_LOG_RETRY` and its consumer) and redeploy. The gateway's queue handler re-sends each delivery with backoff, up to `max_retries`.

### proxy-cache needs a custom domain

proxy-cache stores responses with the Workers Cache API, which only works for a Worker on a custom domain or route. On `*.workers.dev` every request is a cache miss (`X-Cache-Status: Miss`), and nothing breaks. Add a custom domain to `edgway-gateway` before relying on it.

## Config history and rollback range

Every publish adds a version. Rolling back can reach any version that is still kept:

- the newest 100 versions;
- every version published in the last 7 days;
- the live version.

Older versions are pruned after a publish, at most 50 at a time. Their signed snapshots leave KV and their rows leave D1. A rollback to a pruned version is refused with `EDG-ADM-018` (410), which names the oldest version still kept. The numbers are `CONFIG.retainVersions` and `CONFIG.retainSeconds` in `@edgway/constants`.

Developer portal publishes count as versions too:

- They are batched to at most one per second.
- Each developer may make 10 key writes a minute (create, roll, rename or delete). This is the portal's `PORTAL_WRITES` Rate Limiting binding; past it, the portal answers 429 (`EDG-RL-001`).
- An install takes at most 10,000 portal developers. A new developer past that is refused with `EDG-ADM-017`.
- An admin publish that loses a race to a portal batch tries again rather than failing.

## Secrets for plugins and credentials

Secrets never go in D1 for jwt credentials and certificate keys: a jwt credential's `secret` and a certificate's `key` must be Kong vault references, which the gateway resolves when it loads a published config.

A plugin's secret fields take a vault reference too, wherever Kong's schema marks the field referenceable (for example openid-connect's `client_secret`, or rate-limiting's `redis.password`). A plain-text value there is accepted, as Kong accepts it, but it is stored in D1. Every publish then lists it under `warnings`, naming the plugin and the fields, never the values; the admin UI and `edgway publish` show the warning. Move such a secret to a Worker secret or Secrets Store and reference it.

- `{vault://env/vault-jwt-key}` reads the gateway's secret `VAULT_JWT_KEY` (`wrangler secret put VAULT_JWT_KEY --config apps/gateway/wrangler.jsonc`). Kong's mapping applies: upper case, dashes to underscores. Only names starting with `VAULT_` resolve, so a reference can never read the gateway's own secrets, such as `CONFIG_PUBLIC_KEY`.
- `{vault://cf-secrets-store/NAME}` reads the Secrets Store binding `NAME`.
- `/field` at the end reads one field of a JSON secret, for example `{vault://env/vault-oidc/client_secret}`.

A reference that doesn't resolve fails closed: the plugin's routes answer 500 (`EDG-CFG-003`), and the gateway tries again every 10 seconds. Upgrading from a release without the `VAULT_` rule: rename the gateway's vault secrets with the prefix, and update the references to match.

## Private upstreams

A service whose upstream is public HTTPS needs nothing extra. To send a service to another Worker or to a private network, bind it to the gateway and tag the service:

- a Service Binding under `services` in `apps/gateway/wrangler.jsonc`, and the service tag `edgway-binding:<BINDING>`;
- a Workers VPC service under `vpc_services` (a private network reached through Cloudflare Tunnel), and the tag `edgway-tunnel:<BINDING>`. This tag is the whole mechanism: there is no separate tunnel entity.

A Worker on the same zone as the gateway needs a Service Binding: that includes every Worker on your account's `*.workers.dev` subdomain. Cloudflare refuses a Worker's fetch to another Worker on its zone, so a service pointed at such a Worker's URL gets `404` with the body `error code: 1042`, which the gateway passes through as the upstream's response.

The binding's name must start with `UPSTREAM_` (for example `UPSTREAM_ORDERS`). A tag naming any other binding answers 502 (`UPSTREAM_BINDING_MISSING`), so a service can never reach the gateway's own bindings. Tags travel through decK and Terraform like any Kong tag. A service whose host names a Kong upstream is balanced over its targets instead; round-robin position and passive health carry over a publish that leaves the upstream and its targets unchanged. The balancer runs `round-robin` and `consistent-hashing`. `least-connections` (and Kong's `latency`) runs as round-robin on Workers: the upstream is accepted, so decK configs keep syncing, but every publish lists it under `warnings`, and the gateway logs `gateway.upstream_algorithm_fallback` once per published config.

## Timed walkthrough

The target is under 10 minutes from clicking the button to a published route answering through the gateway. Each step below has a target time, and the measured column is filled in from a real run on a fresh account.

| Step | Target | Measured |
| --- | --- | --- |
| Button → repository created, build started | 1 min | not yet measured |
| Build: install, provision, migrate, deploy the three Workers, keys | 4 min | not yet measured |
| Access application + admin vars + redeploy | 3 min | not yet measured |
| `deck gateway sync` (or `edgway import-deck`) + publish, first request through the gateway | 2 min | not yet measured |
| **Total** | **10 min** | not yet measured |

## Upgrading an install from before the trace keys

Earlier releases gave the portal `CONFIG_SIGNING_KEY` and signed route-tester traces with it. Now the portal publishes through the admin, and traces have their own pair. `pnpm run deploy` handles the upgrade:
- it deletes `CONFIG_SIGNING_KEY` from the portal;
- it installs the trace pair (`TRACE_SIGNING_KEY` on the admin, `TRACE_PUBLIC_KEY` on the gateway);
- it keeps the existing snapshot pair, so published versions stay valid.

If you deploy by hand, run `wrangler secret delete CONFIG_SIGNING_KEY --config apps/portal/wrangler.jsonc` yourself.

## Rotating the signing keys

Delete both secrets of a pair: `CONFIG_SIGNING_KEY` on the admin and `CONFIG_PUBLIC_KEY` on the gateway (or `TRACE_SIGNING_KEY` and `TRACE_PUBLIC_KEY` for the trace pair), with `wrangler secret delete <name> --config apps/<worker>/wrangler.jsonc`. Then run `pnpm run deploy`, which installs a new pair. The gateway rejects snapshots signed with the old snapshot key, so publish again straight after.

If only one secret of a pair is set (for example, a first deploy that stopped half way), `pnpm run deploy` stops rather than generate a new pair, because that would invalidate what the old one signed. Copy the existing pair to the missing secret, or delete both to rotate.
