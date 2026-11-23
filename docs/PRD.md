# Edgway PRD v2: Open-Source Edge API Gateway (streamlined)

Sep 29, 2026 · @Drew Kennedy · supersedes the Sep 28 draft

> **What changed in v2.** Scope is unchanged: every v1 feature from the Sep 28 draft is still here. What changed is *how* each piece gets built. Every component now names the open-source package (or, failing that, the Cloudflare product behind an adapter) that does the work, and anything we still write ourselves is listed in one place, the [custom-code register](#custom-code-register). The three biggest changes:
>
> 1. **Kong Admin API compatibility (3.9 OSS surface).** The real decK CLI and Kong's own Terraform provider then work against Edgway. This replaces a hand-written decK importer and a hand-written Go Terraform provider.
> 2. **Plugin schemas come from Kong, not from us.** Kong publishes every plugin's config as JSON Schema (MIT, `Kong/developer.konghq.com`). We generate zod from it at build time, so decK files map one-to-one by construction.
> 3. **Admin UI, portal and docs are assembled, not built.** ra-core + shadcn for the admin, Zudoku for the developer portal, Fumadocs for docs, and react-jsonschema-form for every plugin form.

## Summary

Edgway is an open-source API gateway that runs on Cloudflare Workers. It speaks Kong's Admin API, entity model, plugin names and plugin config, and splits into a control plane and a data plane the way Kong does. So Kong users, decK files and Kong's Terraform provider work with it. It reaches private backends through Cloudflare Tunnel via Workers VPC, which other edge gateways charge enterprise prices for.

**The problem** (unchanged). Kong doesn't run at the edge, and Konnect Serverless is capped at 100 requests per second. Zuplo charges enterprise prices for private tunnels. API Shield has no portal or self-serve keys. Existing Workers gateways stop at routing and JWT checks.

**The bet, sharpened.** Edgway is composition. Hono supplies the router, the proxy and about 60% of Kong's plugin surface as built-in middleware. Kong supplies the API contract, the schemas and the tooling (decK, the Terraform provider). Cloudflare supplies the runtime, storage, sandboxing and tunnels. The code we own is the glue: a phase runner, the adapters and the Kong compatibility layer.

## Engineering principles

### 1. The reuse ladder

Every component is sourced in this order. A reviewer can reject any PR that skips a rung without writing down why.

1. **An existing OSS library** (MIT, Apache-2.0, BSD or ISC; never AGPL in shipped code), used as-is or wrapped thinly.
2. **Kong's own OSS artifacts**: schemas, API contracts and CLIs (Apache-2.0 or MIT), reused as data or as external tools.
3. **A Cloudflare managed product, behind an adapter interface** in `@edgway/adapters-cf`, so `core` stays runtime-agnostic.
4. **Custom code**, only when rungs 1 to 3 have nothing that fits. Each piece is recorded in the [custom-code register](#custom-code-register) with its reason.

### 2. Everything is a callable package

Every capability lives in a workspace package with a typed public entry point. Apps are thin shells that wire packages together. Nothing depends on an app.

| Published to npm (outside value) | Internal only |
| --- | --- |
| `@edgway/core`, `@edgway/plugin-sdk`, `@edgway/plugin-*` (each first-party plugin), `@edgway/sdk`, `@edgway/schema`, `@edgway/errors`, `@edgway/i18n`, `@edgway/constants`, `@edgway/adapters-cf`, `edgway` (CLI) | `@edgway/tokens`, `@edgway/telemetry`, `@edgway/ui-kit`, `@edgway/kong-compat`, `@edgway/admin-core` (service layer shared by both admin mounts) |

The test for publishing: could someone use it in their own Worker without deploying Edgway? `@edgway/plugin-rate-limiting` can be used as plain Hono middleware, so it is published. `@edgway/tokens` has no outside use, so it stays internal. A published package may depend only on published packages: `@edgway/errors` renders its messages through `@edgway/i18n`, which reads header names from `@edgway/constants`, so both are published (Drew, 2026-09-29). Internal packages are marked `"private": true`.

### 3. Pin what's young

Dependencies before 1.0 (Zudoku, `@hey-api/openapi-ts`, `citty`) are pinned exactly, as are experimental APIs we depend on. Each one is covered by a contract test, so an upgrade that breaks it fails CI rather than production.

## Goals, non-goals and success metrics

**Goals** (unchanged, with the delivery method now stated)

1. A production-grade edge gateway you can deploy to your own Cloudflare account in under 10 minutes, via a **Deploy to Cloudflare button** and wrangler's automatic provisioning of D1 and KV.
2. Kong-shaped concepts **and a Kong-compatible Admin API**, so a Kong setup migrates in an afternoon with the *real* `deck gateway sync`.
3. Private backends through Tunnels at no extra licence cost.
4. An admin GUI as capable as Kong Manager, with every plugin form generated from its schema.
5. Internationalization, a typed error catalog and design tokens from the first commit.

Also in v1 (unchanged): Kong decK import, a developer portal, AI gateway plugins, the `edgway` CLI and Terraform support.

**Non-goals for v1** (unchanged): running outside Cloudflare (the core stays portable), parity with Kong's 100+ plugins, monetization or billing, service mesh, GraphQL federation, gRPC transcoding, and a hosted SaaS in v1. Tenant boundaries are still designed in from the start.

**Success metrics**

| Metric | Target |
| --- | --- |
| Latency Edgway adds, p50 / p99, with 3 plugins | < 5 ms / < 20 ms (measured with `oha`) |
| Time from Deploy button to first proxied request | < 10 min |
| Config change reaching all edge locations | < 60 s (a DO push makes this seconds in practice) |
| `deck gateway sync` of Kong sample configs against Edgway | > 90% of entities, no hand edits |
| Hard-coded user-facing strings | 0 (enforced by lint) |
| **New:** lines in the custom-code register outside `core`'s phase runner | Tracked per release, and expected to shrink |

## Users and personas

Unchanged: the solo builder with a portfolio, the small SaaS team already on Cloudflare, the Kong OSS user, and the plugin author. v2 serves the Kong OSS user better, because their existing decK files, Terraform and muscle memory work without change.

## Landscape and positioning

Unchanged. One fact to record: **Kong Gateway 3.9.x is the last OSS release.** 3.10 and later are Enterprise-only ([discussion](https://github.com/Kong/kong/discussions/14628)). That gives Edgway a stable, frozen compatibility target and a clear audience: Kong OSS users with no free upgrade path.

**Trademark.** Kong's [branding page](https://konghq.com/company/branding) allows "works with Kong" and "compatible with Kong" in text. Edgway never uses "Kong" in a product, package or domain name, never uses the logo, and carries a "not affiliated with Kong Inc." notice.

## Architecture

The control plane / data plane split is unchanged. Both run on Workers and share only a signed, versioned config snapshot. Nothing on the request path calls the admin side.

**Control plane (`apps/admin` Worker)**

- The admin API is built with Hono and `@hono/zod-openapi`. It has two mounts:
  - `/api/v1/*`: the native Edgway API. The OpenAPI spec comes from the zod schemas and drives SDK generation.
  - `/` (Kong-compatible mount, `@edgway/kong-compat`): the Kong 3.9 Admin API subset that decK and Kong's Terraform provider call (see [Kong compatibility](#kong-compatibility-layer)). Both mounts call the same service layer, so there is one set of business logic.
- D1 is accessed through Drizzle ORM; zod schemas come from the tables via `drizzle-zod` (moving to `drizzle-orm/zod` at Drizzle v1). Entity IDs are **UUIDv7** (`uuidv7`), because Kong's API, decK and Terraform all expect UUIDs.
- On publish, the admin compiles entities into one snapshot, validates it against every plugin's schema, and computes the diff with `microdiff`. It signs a manifest `{version, sha256}` with **jose** (`CompactSign`, EdDSA or HS256) instead of a custom HMAC, writes `config:v{n}`, and moves `config:current`. Rollback moves the pointer back.
- Admin identity: Cloudflare Access for self-hosted installs, verified with `@hono/cloudflare-access` rather than hand-rolled JWT checks. For the planned hosted edition, **Better Auth** (D1/Drizzle adapter, organization and access-control plugins) behind the same `AdminIdentity` interface. This answers the open question in the Sep 28 draft.
- Serves the admin UI via Workers Static Assets with an SPA fallback.

**Data plane (`apps/gateway` Worker)**

- A Hono app assembled at config-load time: each Kong route becomes Hono route registrations, and a phase runner (`@edgway/core`) executes the plugin chain.
- Config comes from KV, cached in memory per isolate. A Durable Object pushes version bumps, because KV takes 60 seconds or more to propagate.
- The proxy is `hono/proxy`, which handles hop-by-hop headers and streaming bodies. It sits behind the `Upstream` adapter, which has three variants: public URL, Service Binding, and Workers VPC (beta). If VPC is unavailable, the fallback is a public Tunnel hostname plus an Access service token.
- Resilience: **cockatiel** provides upstream retries, timeouts and circuit breakers (the circuit breaker doubles as Kong's passive health check). Active health checks run as a DO alarm per upstream; the Cloudflare Load Balancing product is an optional adapter.
- Load balancing: `consistent-hash` for Kong's `consistent-hashing` algorithm. Weighted round-robin is custom (about 30 lines; the only npm option is unlicensed and from 2014).
- State:
  - Rate-limit counters go through the `RateLimitStore` adapter (see [rate-limiting](#first-party-plugins)).
  - Response caching uses **Workers Cache**, which supports global purge by tag and prefix via `ctx.cache.purge`, with `hono/cache` as the fallback adapter.
- Telemetry:
  - Metrics: Analytics Engine.
  - Traces and logs: **native Workers tracing with OTLP export**, plus custom spans through `cloudflare:workers` `tracing`. This replaces `otel-cf-workers`, whose maintainer now recommends the native path.
  - Structured logs: **LogTape**.
  - Field names: `@opentelemetry/semantic-conventions`.
  - Log shipping: Workers Logpush or Tail Workers instead of a custom Queues shipper. Queues are kept only for guaranteed delivery (the audit log and the `http-log` plugin's retry buffer).

**Entity model**: Kong's entities, kept as-is, now including Kong's exact field names and UUID IDs.

| Entity | Kong equivalent | Edgway note |
| --- | --- | --- |
| Service | Gateway Service | `url`/`host`/`port`/`path`/`protocol` as Kong defines them; a service tag selects a Worker binding (`edgway-binding:<BINDING>`) or a Workers VPC binding reaching a private backend through Cloudflare Tunnel (`edgway-tunnel:<BINDING>`) |
| Route | Route | Kong fields (`paths`, `methods`, `hosts`, `headers`, `strip_path`, `regex_priority`, …) |
| Upstream / Target | Same | Algorithms: round-robin, consistent-hashing. least-connections runs as round-robin on Workers: accepted so decK configs keep syncing, and every publish warns |
| Consumer / Consumer Group | Same | Credentials per auth plugin (`/key-auths`, `/basic-auths`, `/jwts`, `/acls`) |
| Plugin | Plugin | Scoped global, service, route or consumer, with Kong's precedence |
| Certificate / CA Certificate / SNI | Same | Mapped to Cloudflare mTLS certificate bindings for upstream mTLS |
| Vault | Vault | `{vault://env/NAME}` and `{vault://cf-secrets-store/NAME}`; Secrets Store is beta and behind the `SecretResolver` adapter |
| Workspace | Workspace | Deferred; `workspace_id` on every table from the first migration |

## Kong compatibility layer

This is the single highest-leverage piece in v2. Implementing the Admin API subset that decK and Kong's Terraform provider use turns four hand-built v1 features into integrations:

| v1 feature | Sep 28 plan | v2 plan |
| --- | --- | --- |
| decK import | Hand-written YAML importer | Users run the real `deck gateway sync` / `deck gateway dump` (Apache-2.0) against Edgway. `edgway import-deck` wraps the same service layer for offline use. |
| Terraform provider | Hand-written Go provider in `apps/terraform` | Users use Kong's `Kong/kong-gateway` provider against Edgway. Edgway-only actions (publish, rollback) use a published module over the generic `Mastercard/restapi` provider. No Go in the repo. |
| Kong Manager parity | Rebuild every view | Still our own React UI, but it now shares Kong's API shape, so Kong Manager's list → detail → edit flow maps one-to-one. |
| Plugin config fidelity | Hand-written zod per plugin | Generated from Kong's JSON Schemas. |

**Endpoints required** (to be confirmed against decK's source during Phase 1):
- `GET /`, returning a Kong 3.9 version string and `configuration.database`.
- `GET /status`.
- Paginated `GET /{entity}?size=&offset=&tags=` returning `{data, next}`, for services, routes, plugins, consumers, consumer_groups, upstreams, targets, certificates, snis, ca_certificates, vaults, key-sets, keys, and the credential collections.
- `POST`, `PUT`, `PATCH`, `DELETE /{entity}/{id}`.
- `GET /schemas/{entity}` and `GET /schemas/plugins/{name}`.

Unsupported plugins return Kong's own "plugin not enabled" error shape. Writes on the Kong mount stage changes like any other admin write. `deck gateway sync --publish` (an Edgway header or flag) or a separate `edgway publish` makes them live, so the staged-diff improvement over Kong is kept.

## Plugin system

### Shape

A plugin is an npm package that exports `definePlugin()` from `@edgway/plugin-sdk`. Its config schema is not written by hand when Kong has the plugin:

```ts
import { definePlugin } from "@edgway/plugin-sdk";
import { kongSchema } from "@edgway/schema/kong";      // generated from Kong's JSON Schema
import { cors } from "hono/cors";                       // the actual implementation

export default definePlugin({
  name: "cors",                                          // Kong's name, so decK maps 1:1
  version: "1.0.0",
  priority: 2000,                                        // Kong's priority for cors
  config: kongSchema("cors"),                            // zod, generated at build time
  messages: {},                                          // i18n keys only
  access: (cfg) => cors({                                // map Kong fields onto the library
    origin: cfg.origins ?? "*",
    allowMethods: cfg.methods,
    allowHeaders: cfg.headers,
    exposeHeaders: cfg.exposed_headers,
    credentials: cfg.credentials,
    maxAge: cfg.max_age,
  }),
});
```

A phase handler returns ordinary Hono middleware, so every first-party plugin is also usable as plain Hono middleware outside Edgway. That is what makes the plugin packages worth publishing.

### Schemas: from Kong, not by hand

- **Source:** `Kong/developer.konghq.com` → `app/_schemas/gateway/plugins/<version>/<Name>.json` (MIT). These are real JSON Schema, with defaults, enums and descriptions, refreshed by a bot on every Kong release. We vendor the 3.9 set.
- **Build step** (`packages/schema`, a Turborepo task):
  - Generate zod TypeScript from each vendored schema with `@hey-api/openapi-ts`'s zod plugin (pinned), and commit it with snapshot tests. zod has no way to print a `z.fromJSONSchema()` result as source, so that API is not used for Kong's schemas (decided by Drew).
  - `json-schema-to-zod` is deprecated. Avoid it.
- **Serving:** the admin exposes the same JSON Schema at Kong's `/schemas/plugins/{name}`. The UI, the portal and decK all read it.
- **Edgway-only plugins** (none in v1 beyond Kong's names) write their schema in zod and export JSON Schema with `z.toJSONSchema()`.
- **Runtime validation of raw JSON Schema** inside Workers uses `@cfworker/json-schema`. Plain `ajv` uses `new Function`, which Workers blocks.

### Phases

Kong's phase order, minus `certificate` and `balancer` (Cloudflare owns TLS termination; balancing is the Upstream adapter):

1. `rewrite`: before route matching; global plugins only.
2. `access`: authentication, authorization, rate limits and request changes. May end the request early.
3. `header_filter` / `body_filter`: response changes. Body changes use a `TransformStream`, never buffering.
4. `log`: after the response, inside `waitUntil`.

The runner in `@edgway/core` is the one piece of framework code we write, because no OSS equivalent exists. It is built from Hono's `combine`, `timeout`, `factory` and `context-storage` helpers.

### Robustness: isolation tiers

| Tier | Mechanism | Guarantees | When |
| --- | --- | --- | --- |
| Bundled (first-party and trusted npm) | Compiled in. Each handler is wrapped by the runner in a **cockatiel** policy: timeout, circuit breaker and an error boundary. Per-plugin `on_error: fail-open \| fail-closed` (fail-closed by default for auth and rate limiting, so a broken enforcement plugin stops the request; decided by Drew). | A thrown error or slow async call can't take down the chain. | Phase 1 |
| Sandboxed (third-party, untrusted) | **Cloudflare Dynamic Workers** (Worker Loader, open beta), behind a `PluginSandbox` adapter. Per-load `cpuMs` and `subRequests` limits, `globalOutbound: null` by default, only allow-listed bindings over RPC. | CPU-bound or hostile code is contained. In-isolate timeouts cannot stop a CPU loop, so this tier is required for untrusted code. | Phase 5 |
| WASM (proxy-wasm) | **Dropped from the plan.** No maintained JS/Workers proxy-wasm host exists. Revisit if one appears. | n/a | n/a |

Every plugin also gets, for free from the runner:
- per-plugin timing into Analytics Engine;
- a span per phase;
- the route-tester trace ("what each plugin decided").

### Third-party ecosystem

- **Convention:**
  - npm keyword `edgway-plugin`.
  - The package's default export is `definePlugin(...)`.
  - It declares a peer dependency on `@edgway/plugin-sdk`.
  - Messages ship in the package and merge into the catalog at build time.
- **Registration:**
  - Plugins are named in `edgway.config.ts`, loaded with **c12** (the 3.x line; 4.0 is still an RC).
  - A codegen step writes a static-import registry file (`.edgway/plugins.gen.ts`) that Wrangler bundles.
  - Wrangler's esbuild does not accept plugins, so codegen replaces the virtual modules a bundler plugin would normally provide.
- **UI:** because every plugin exposes JSON Schema, its form appears in the admin with no UI code (see [Admin UI](#admin-ui)).
- **Dev loop:**
  - `edgway plugin new` scaffolds a package.
  - `@edgway/plugin-sdk/testing` wraps `@cloudflare/vitest-pool-workers` with a fake context and fake upstream.

### First-party plugins

Kong's names are kept; the "Built on" column shows the library that does the work.

| Plugin | Built on | Custom glue |
| --- | --- | --- |
| `key-auth` | `hono/bearer-auth` (custom header, prefix and `verifyToken`) | Kong's `key_names`, `key_in_query` and `hide_credentials`. Keys are generated with `nanoid`, stored as a SHA-256 hash plus a display prefix, and shown once. |
| `jwt` | `jose` | Credential lookup by Kong's `key_claim_name` (`hono/jwt` supports only one key) |
| `basic-auth` | `hono/basic-auth` (`verifyUser`) | Credential lookup |
| `openid-connect` | `openid-client` (panva) for relying-party flows, `hono/jwk` for bearer and JWKS, `@hono/oidc-auth` for session login | Mapping from Kong's config. Kong's version is Enterprise; its schema is still public. |
| `acl` | none | An allow/deny check against consumer groups (register) |
| `cors` | `hono/cors` | Field mapping |
| `ip-restriction` | `hono/ip-restriction` + `getConnInfo` | Field mapping |
| `rate-limiting` | `hono-rate-limiter` middleware plus the `RateLimitStore` adapter: the **Cloudflare Rate Limiting binding** for `second`/`minute` windows with Kong's `policy: local`, and a Durable Object counter for exact and hour/day/month/year windows (`policy: cluster`) | The DO counter (register); the maintained DO store package is stale |
| `request-size-limiting` | `hono/body-limit` | Unit conversion |
| `request-transformer` / `response-transformer` | none (optionally `jsonata` for advanced cases) | Kong's add/remove/rename/replace/append operations (register) |
| `proxy-cache` | Workers Cache (`ctx.cache`, purge by tag) with `hono/cache` as fallback | Mapping Kong's cache-key rules |
| `request-termination` | none | Trivial (register) |
| `correlation-id` | `hono/request-id` | Field mapping |
| `http-log` | `fetch` in `waitUntil`; Queues for retries | Kong's payload shape |

**AI gateway plugins** (Kong's names):

| Plugin | Built on | Notes |
| --- | --- | --- |
| `ai-proxy` | **Vercel AI SDK** (`ai` + `@ai-sdk/openai`, `@ai-sdk/anthropic`, `workers-ai-provider`) for format translation and failover; plain pass-through when the formats already match. Optional Cloudflare AI Gateway backend via `ai-gateway-provider` (the Universal Endpoint is deprecated). | Portkey's gateway (MIT) is the reference for provider transforms; vendor from it only where the AI SDK has a gap. |
| `ai-rate-limiting-advanced` | The same `RateLimitStore`, counting tokens | Token counts come from provider `usage` fields in the response; `gpt-tokenizer` is used only for estimates before the request. `@anthropic-ai/tokenizer` is unmaintained, so don't use it. |
| `ai-prompt-guard` | Regex allow/deny patterns (Kong's schema) | Trivial (register) |

## Admin UI

**Stack:**

| Need | Package |
| --- | --- |
| CRUD framework (lists, detail, edit, pagination, optimistic updates) | **ra-core** (react-admin's headless core, MIT, very active) with components from **shadcn-admin-kit** |
| Data layer | A react-admin `dataProvider` wrapping the generated `@edgway/sdk`, on TanStack Query v5 |
| Plugin and entity forms | **react-jsonschema-form** + **@rjsf/shadcn** (the official theme), fed by `/schemas/plugins/{name}` |
| App shell, sidebar, ⌘K palette | Layout taken from `satnaing/shadcn-admin` (MIT); **cmdk** via shadcn `Command` |
| Tables | TanStack Table (via shadcn data-table) |
| Code and diff views | `@monaco-editor/react` (lazy-loaded) for the "view as decK/YAML" toggle, the `DiffEditor` for staged-publish diffs, and the Phase 5 plugin editor |
| Charts | Recharts via shadcn charts (Tremor's npm package is stale) |
| API reference inside the admin | Scalar |

**Proposed framework change (needs Drew):** the Sep 28 draft proposed a Next.js static export. An admin app is almost entirely dynamic routes (`/services/:id`), which `output: "export"` can't serve without listing every ID at build time. v2 proposes **React on Vite** (with React Router, as ra-core expects), served as Workers Static Assets with an SPA fallback. It is still React, TypeScript, shadcn and Tailwind. Next.js stays where it fits: the docs site (Fumadocs).

**Layout, modeled on Kong Manager OSS** (design inspiration only; no Vue code reused):

1. **Overview**: traffic, error rate, p50/p99 latency, top routes and consumers, config version and last publish.
2. **Gateway**: Services, Routes, Upstreams.
3. **Consumers**: Consumers, Consumer Groups, Credentials.
4. **Plugins**: a catalog grid grouped by category, scoped instances, and the phase order per route.
5. **Security**: Certificates, CA Certificates, Vaults.
6. **Config**: staged diff, publish, version history, rollback, decK import and export.
7. **Analytics and Logs.**
8. **Settings**: admins and roles, locale, theme, audit log.

**Copied from Kong Manager:**
- the same list → detail → edit flow for every entity;
- nested tabs (service → routes and plugins; consumer → credentials and plugins);
- a config card with JSON, YAML, decK and Terraform snippet views;
- a scope picker on every plugin;
- Save disabled until a real edit is made.

**Improvements on Kong Manager** (unchanged): a staged diff before publish, a route tester that shows each plugin's decision, and a ⌘K palette.

## Developer portal

Replaces the custom Next.js/OpenNext portal with **Zudoku** (MIT, Vite, static output, by Zuplo):

- API reference pages come from each service's OpenAPI spec, which Zudoku renders natively. Scalar stays inside the admin.
- Self-serve API keys: implement Zudoku's `ApiKeyService` (`getConsumers`, `createKey`, `deleteKey`, `rollKey`, `updateConsumer`, `getUsage`) against the Edgway admin API's consumers and `key-auth` credentials.
- Consumer sign-in through Zudoku's OIDC support, pointed at Better Auth's OIDC provider (hosted) or any IdP (self-hosted).
- Theming and messages come from `@edgway/tokens` and `@edgway/i18n`.
- Zudoku is pre-1.0, so pin it exactly.
- `apps/portal` is a Zudoku config plus the `ApiKeyService` implementation. No hand-written pages.

## Docs site

**Fumadocs** (Next.js static export, MIT), with `fumadocs-openapi` for the admin API reference. The error-code reference and the plugin reference are **generated**: a Turborepo task reads the `@edgway/errors` registry and each plugin's JSON Schema and writes MDX. Nobody maintains those pages by hand.

## CLI (`edgway`)

| Need | Package |
| --- | --- |
| Commands | **citty** (pinned; `commander` is the fallback) |
| Interactive `init` | `@clack/prompts` |
| `edgway.config.ts` | **c12** |
| decK YAML | `yaml` (keeps comments) + decK's `kong_json_schema.json` from `Kong/go-database-reconciler` |
| `diff` output | `diff` (jsdiff) + `node:util.styleText` |
| API calls | `@edgway/sdk` |

Commands (unchanged): `init`, `deploy` (wraps `wrangler deploy` and the D1 migrations), `import-deck`, `diff`, `publish`, plus `plugin new`. `import-deck` works offline; online users can equally run `deck gateway sync`.

## Terraform

v1 ships Terraform support without a hand-written Go provider:

1. **Kong's `Kong/kong-gateway` provider** (Speakeasy-generated, maintained by Kong) pointed at Edgway's Kong-compatible mount. This covers services, routes, consumers, credentials, upstreams, certificates and plugins.
2. **An Edgway Terraform module** (published to the registry) over the generic **`Mastercard/restapi`** provider, for Edgway-only actions: publish and rollback.
3. HashiCorp's OpenAPI codegen is a stale tech preview that still needs hand-written CRUD in Go, so it is **not used**. A native `terraform-provider-edgway` is reconsidered only if 1 and 2 prove insufficient. That is a decision for Drew.

## Internationalization, errors and shared packages from day one

The principle is unchanged: no inline user-facing strings, errors, status codes, colors or magic numbers. The packages behind it:

| Package | Built on | Notes |
| --- | --- | --- |
| `@edgway/i18n` | **FormatJS** (`@formatjs/intl` + `@formatjs/cli`) with Hono's `languageDetector` and `contextStorage` | The mainstream ICU toolchain: messages are declared with `defineMessage`, extracted to `lang/en.json`, compiled (with a pseudo-locale) for runtime, and checked with `formatjs verify`. The same catalog serves the Worker (per-request locale from Accept-Language) and the UI via `react-intl`. Formatting goes through FormatJS/Intl. Enforced by `eslint-plugin-formatjs` and `eslint-plugin-i18next`; unused messages are caught by knip. This resolves decision #4 (Drew, 2026-09-29). |
| `@edgway/errors` | **hono-problem-details** (MIT; RFC 9457, zod and OTel trace-id integrations) | Our registry is a typed `as const` map (code → status, i18n key, docs URL) fed into it. A `kong` compatibility mode returns `{"message": "..."}`, and the Kong mount always uses Kong's shape. |
| `@edgway/schema` | zod v4 + `drizzle-zod` + zod generated from Kong's schemas | The single source for the API, SDK, UI forms and snapshot validation |
| `@edgway/sdk` | **@hey-api/openapi-ts** (fetch client + TanStack Query plugin + zod) | Pinned; `orval` is the fallback. Generated, never edited. |
| `@edgway/tokens` | **Tailwind v4 `@theme` + shadcn CSS variables** | Replaces a separate token pipeline. Add Terrazzo only if a Figma pipeline appears. |
| `@edgway/telemetry` | `@opentelemetry/semantic-conventions` + LogTape | Field names are OTel's, not invented |
| `@edgway/constants` | none | Header names (`x-edgway-*`), KV key formats and limits (register, pure data) |
| `@edgway/plugin-sdk` | Hono types + cockatiel + vitest-pool-workers helpers | `definePlugin`, phase types, testing kit |
| `@edgway/kong-compat` | `@hono/zod-openapi` + vendored Kong schemas | The Kong Admin API mount and the Kong-shaped serializers |

## Build vs. reuse matrix

| Area | Reused (OSS unless noted) | License | Custom remainder |
| --- | --- | --- | --- |
| HTTP routing, middleware, proxy | Hono 4.13 (`hono/proxy`, `combine`, `timeout`, `factory`) | MIT | Phase runner, route compiler |
| Admin API + OpenAPI | `@hono/zod-openapi` | MIT | Handlers |
| Kong API, entity and plugin contracts | Kong developer docs JSON Schemas; decK `kong_json_schema.json` | MIT / Apache-2.0 | Serializers |
| Schema conversion | `@hey-api/openapi-ts` zod plugin (Kong JSON Schema → zod code); zod 4 `z.toJSONSchema`; `@cfworker/json-schema` | MIT | Codegen script |
| JWT, JWKS, OIDC, snapshot signing | jose, openid-client, `@hono/oidc-auth` | MIT | Config mapping |
| Admin identity | `@hono/cloudflare-access`; Better Auth (hosted) | MIT | none |
| Database, migrations | drizzle-orm, drizzle-kit, drizzle-zod | Apache-2.0 / MIT | Tables |
| IDs, keys | uuidv7, nanoid | Apache-2.0 / MIT | none |
| Config diff | microdiff | MIT | none |
| Rate limiting | hono-rate-limiter; CF Rate Limiting binding (managed) | MIT | DO counter store |
| Resilience | cockatiel | MIT | none |
| Load balancing | consistent-hash | Apache-2.0 | Weighted round-robin, health-check alarm |
| Caching | Workers Cache (managed); `hono/cache` | MIT | Kong cache-key mapping |
| Sandboxing | Cloudflare Dynamic Workers (managed, beta) | n/a | Adapter |
| AI | Vercel AI SDK, `workers-ai-provider`, `ai-gateway-provider`, gpt-tokenizer | Apache-2.0 / MIT | Kong config mapping |
| Errors | hono-problem-details | MIT | Registry data |
| i18n | FormatJS (`@formatjs/intl`, `@formatjs/cli`); Hono `languageDetector` + `contextStorage` | MIT | Catalog |
| Telemetry | Native Workers tracing + OTLP (managed); semantic-conventions; LogTape; Analytics Engine | Apache-2.0 / MIT | Metric definitions |
| Admin UI | ra-core, shadcn-admin-kit, shadcn/ui, RJSF + @rjsf/shadcn, TanStack Table, cmdk, Monaco, Recharts, Scalar; @peculiar/x509 (certificate subject and expiry) with its required Reflect polyfill, reflect-metadata | MIT / Apache-2.0 | dataProvider, pages |
| Tokens | Tailwind v4 | MIT | Token values |
| Fonts (admin UI and portal) | IBM Plex Sans and IBM Plex Mono, self-hosted with `@fontsource/ibm-plex-sans` and `@fontsource/ibm-plex-mono` | OFL-1.1 | none |
| Portal | Zudoku; Recharts for the usage chart | MIT | `ApiKeyService` |
| Docs | Fumadocs + fumadocs-openapi | MIT | Generators |
| SDK | @hey-api/openapi-ts | MIT | none (generated) |
| CLI | citty, @clack/prompts, c12, knitwork (codegen), yaml, diff, esbuild (bundling `dist/`) | MIT / ISC / BSD | Commands |
| decK sync | Kong decK CLI (external tool) | Apache-2.0 | Kong-compat mount |
| Terraform | Kong/kong-gateway provider; Mastercard/restapi | Apache-2.0 / MPL | TF module |
| Monorepo, quality | pnpm, Turborepo, Changesets, Biome, knip, syncpack; ESLint + typescript-eslint for plugin-provided rules only (eslint-plugin-formatjs, eslint-plugin-i18next) | MIT / ISC | none |
| Tests | Vitest 4 (pinned; the pool doesn't support Vitest 5 yet), `@cloudflare/vitest-pool-workers`, Playwright, MSW, oha | MIT / Apache-2.0 | Tests |
| Deploy | Deploy to Cloudflare button, wrangler auto-provisioning | n/a | `deploy` script |

## Custom-code register

These are the only things we write, and each has a reason. A new entry requires a PR that names the rung-1 to rung-3 options it rejected.

| Item | Why custom |
| --- | --- |
| Phase runner + route compiler (`@edgway/core`) | No OSS Hono phase or plugin runner exists (Zuplo's is proprietary). Kong's route priority rules have no JS implementation. |
| Kong-compat serializers and pagination | Kong's API shape is the contract. There's no server-side library for it. |
| Schema codegen script | Glue around `@hey-api/openapi-ts`'s zod plugin |
| DO rate-limit counter store | `@hono-rate-limiter/cloudflare` is stale (2024) and marked legacy |
| `request-transformer`, `response-transformer`, `acl`, `request-termination`, `ai-prompt-guard` | Kong's semantics are small, simple operations. No library matches them. |
| Weighted round-robin + health-check alarm | The only npm option is unlicensed (2014). Cloudflare Load Balancing is paid and optional. |
| Adapters (`Upstream`, `RateLimitStore`, `CacheStore`, `PluginSandbox`, `SecretResolver`, `ConfigStore`, `AdminIdentity`) | The portability boundary; each is a thin wrapper |
| Zudoku `ApiKeyService`, ra-core `dataProvider` | Integration points those libraries expect us to provide |

## Security, observability and limits

The Sep 28 content is unchanged except for the following.

- **Admin auth:** the Access JWT is verified by `@hono/cloudflare-access`. The Kong mount accepts a `Kong-Admin-Token` header, which is mapped to an Access service token or a Better Auth API key, so decK and Terraform can authenticate.
- **Snapshots:** signed with jose (EdDSA preferred, so the gateway holds only a public key), not a bespoke HMAC.
- **Credentials:**
  - Generated with nanoid and stored as SHA-256 hash plus prefix.
  - Never returned after creation. The scaffold currently returns key hashes to the UI; that is removed.
  - Never placed in cache keys. The scaffold currently puts raw credentials in a cache-key header; that is removed.
- **Plugins:** the error boundary and timeouts come from cockatiel, and untrusted code runs in Dynamic Workers. Fail-closed is the default for auth plugins.
- **Observability:**
  - `x-edgway-request-id` via `hono/request-id`.
  - Traces via native Workers OTLP export. OTLP events are billed from 2026-10-01 on the Paid plan, beyond an included amount; the budget is documented in the deploy guide.
- **Limits:** 128 MB per isolate, so bodies always stream (`hono/proxy` does this; the scaffold's `arrayBuffer()` buffering is removed). The CF Rate Limiting binding only supports 10-second and 60-second periods and is eventually consistent per colo, which is why exact and long windows use the DO store.

## Roadmap

The phase structure and gates are unchanged. Two sequencing changes follow from v2:

- **Phase 1** adds the Kong-compat mount's read endpoints (`GET /`, list, get and schemas), so `deck gateway dump` works early. This is the cheapest end-to-end proof that the contract is right.
- **Phase 2** (replace Kong for Drew's apps) is reached through `deck gateway sync` of Drew's existing Kong config, which is the real acceptance test.

## Decisions log

| # | Decision | v2 default | Status |
| --- | --- | --- | --- |
| 1 | Build fresh or start from the repo | Migrate incrementally from the scaffold | Decided |
| 2 | License | Apache-2.0 (the scaffold is still MIT; switch in step 0) | Decided |
| 3 | Admin UI framework | React + Vite + ra-core + shadcn (was a Next.js static export) | Decided: built (Step 7, approved) |
| 4 | i18n library | FormatJS (react-intl in the UI) + Hono language detection | Decided (Drew, 2026-09-29) |
| 5 | Locales at launch | `en` plus a pseudo-locale | Needs Drew (unchanged) |
| 6 | Error wire format | RFC 9457 via hono-problem-details; Kong shape on the Kong mount | Proposed |
| 7 | Multi-tenancy | One tenant, `workspace_id` from day one | Decided |
| 8 | Rate-limit accuracy | CF binding for Kong `policy: local`; DO for `cluster` and long windows | Proposed |
| 9 | Business model | Open source first, hosted later | Decided |
| 10 | First real workload | Needs Drew (unchanged) | Needs Drew |
| 11 | v1 scope | Everything from Sep 28 stays in v1 | Decided |
| 12 | **New:** Kong compatibility target | The Kong 3.9 OSS Admin API + decK | Proposed |
| 13 | **New:** Terraform delivery | Kong's provider + an Edgway module on `restapi`; no Go | Decided: built (Step 8, approved; Drew, 2026-10-02) |
| 14 | **New:** Developer portal | Zudoku instead of custom Next.js/OpenNext | Proposed |
| 15 | **New:** Admin identity beyond Access | Better Auth for the hosted edition | Proposed (answers the open question) |
| 16 | **New:** Entity IDs | UUIDv7, not prefixed IDs, for Kong compatibility | Proposed |

**Open questions still open:** which AI providers to support first (proposed: OpenAI, Anthropic and Workers AI, all through the AI SDK), and whether the portal needs billing (proposed: no, key issuance and docs only, matching the non-goals).

## Risks and mitigations

The Sep 28 risks still apply. New or changed:

| Risk | Impact | Mitigation |
| --- | --- | --- |
| decK or Kong's Terraform provider calls endpoints or fields we don't implement | Sync fails | A Phase 1 spike runs `deck gateway dump/sync` and `terraform plan` against the mount in CI with fixtures |
| Generated zod drifts across generator or zod upgrades | Schemas change silently | Generated output is committed with snapshot tests and a codegen diff check; both tools are pinned exactly |
| Pre-1.0 dependencies (Zudoku, hey-api, citty) | Breaking upgrades | Exact pins, Renovate grouped PRs, and a contract test per integration |
| Beta Cloudflare products (Workers VPC, Dynamic Workers, Secrets Store, OTLP export) | Changes or new pricing | Each sits behind an adapter with a documented fallback |
| Kong OSS frozen at 3.9 | Newer Kong schema fields diverge | Pin to 3.9; newer fields are ignored with a warning in import |
| Kong trademark | Naming trouble | "Kong-compatible" in text only, a not-affiliated notice, no logo |
