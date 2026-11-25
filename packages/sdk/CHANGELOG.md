# @edgway/sdk

## 0.1.0

### Minor Changes

- 562c8ee: Production hardening for the first release:
  
  - Vault references: `{vault://env/…}` and `{vault://cf-secrets-store/…}` resolve on the gateway, and secrets never reach D1. A secret that doesn't resolve fails its plugin closed.
  - Fail closed: an enabled plugin the gateway doesn't bundle refuses its routes, and a plugin's `on_error` comes from the published config.
  - Consumer groups scope plugins. Client-sent `X-Consumer-*` and `X-Authenticated-*` headers are always removed. Authentication plugins follow Kong's anonymous logical OR.
  - Publish integrity: every publish goes through the ConfigVersion Durable Object, and the gateway reads the live version from it.
  - The AI plugins (ai-proxy, ai-prompt-guard, ai-rate-limiting-advanced) run in the gateway with Workers AI and a Durable Object token counter. `@ai-sdk/openai` is dropped.
  - Upstreams: Kong upstreams and targets are balanced, and Service Binding and Workers VPC targets are selected by service tags.
  - Kong route `protocols` (426 for plain HTTP on an https-only route), and `X-Forwarded-For` is appended. `x-edgway-route` is sent only on traced requests.
  - Packages ship their source only (`files`). `@edgway/telemetry` is public, and `@edgway/sdk` pins wrangler 4.124.0.
- 562c8ee: Security, Kong-compatibility and CLI fixes for the first public release.
  
  **Breaking**
  
  - `GATEWAY_PLUGINS` is removed from `@edgway/constants`. The plugins a gateway bundles, and their config schemas, now come from the gateway's registry codegen (`edgway.config.json`), so third-party plugins can be published. Code that imported the list should list its plugins in `edgway.config` and generate the registry with `@edgway/plugin-sdk/registry`.
  - Packages now ship built ESM and `.d.ts` files in `dist` (with LICENSE and NOTICE), not TypeScript sources. Every relative import ends in `.js`, so the output runs under Node and bundlers alike.
  - `@edgway/sdk`'s entry point exports the TanStack Query helpers, so `@tanstack/react-query` is now a required peer dependency.
  - The `edgway` CLI expects `wrangler` (`^4.124.0`) to be installed alongside it, as a peer dependency.
  
  **Security**
  
  - Secrets are masked on every Kong-mount read. basic-auth needs a password. Portal developers can be blocked. Unknown plugin names are refused on every write path.
  - Revoking or rotating a credential in the admin takes effect at the gateway at once. A rollback that would revive a credential warns first and names it.
  - openid-connect:
    - checks the audience, and the session's issuer and audience;
    - removes client-sent copies of the headers it sets.
  - ai-prompt-guard checks every prompt shape. ai-proxy caps the body it reads.
  - proxy-cache never stores `Set-Cookie` responses and honours `Vary`.
  - The client IP is fixed before any plugin runs.
  - http-log redacts credentials and cookies.
  - Upstream redirects are not followed.
  - Vault references resolve only in referenceable fields.
  - The admin UI and portal send a Content-Security-Policy and related headers.
  
  **Kong compatibility and behaviour**
  
  - `path_handling: v1` is supported.
  - The gateway's own endpoints are under a reserved prefix.
  - Routes the router can't compile are refused at publish.
  - request-transformer refuses bodies it can't parse, with a 400.
  - Old config versions are pruned after a publish: the newest 100, those from the last 7 days, and the live one are kept.
  - Portal writes are rate limited, and portal consumers are capped.
  
  **CLI**
  
  - New commands: `versions` and `rollback`.
  - `import-deck --remote` works.
  - `deploy` matches `pnpm run deploy`.
  - New options: `--json`, `--debug` and `diff --exit-code`.
  - Its third-party notices ship in `dist/THIRD_PARTY_NOTICES.txt`.
- 562c8ee: The admin API has `GET /me`, the signed-in identity and its role. The admin UI shows them in the sidebar footer and disables what the role can't do, with a line saying who can: a viewer can't stage, and only a publisher or owner can publish and roll back. The server's role checks are unchanged.
  
  `GET /analytics/overview` takes an optional `hours` (1, 24 or 168; anything else is a 400). The admin overview has a range picker, requests and error-rate tiles, and its chart in the chart colors. The route tester draws each plugin's time as a waterfall with the upstream's share, and names the matched route when the gateway reports one.
  
  The plugin catalog filters by category, and each card says what the plugin does and whether it's in use or staged. The plugin form picks its scope with radio buttons and shows the plugin as decK YAML while you fill it in.
  
  The portal's landing page shows how to get going in three steps and a first `curl` request, against the gateway named by the new optional build variable `ZUDOKU_PUBLIC_GATEWAY_URL`. A developer's usage is a 7-day bar chart, with the numbers behind "Show as a table".
- 562c8ee: `GET /audit-events` filters by `actor`, `action` and `entity_type` and pages with a cursor (`next`), newest first; the page size defaults to 50, at most 200 (`AUDIT_PAGE`). The admin UI has an Audit log page: who changed what and when, filtered by action, each event expanding to its diff and request id, with links to the entity or the published version.
  
  The admin refuses a route path that doesn't start with `/` (or `~` for a regular expression, as Kong requires), naming the path. The route and service forms group their fields (basics, what a route matches, advanced), show the admin's field errors under the field, preview the entity as decK YAML, and say "Stage route" or "Stage service". A service's page shows the upstream its host names, with each target's share of the traffic.
  
  `GET /which-plugins?route=…&consumer=…|consumer_group=…` answers which plugins run for a route and a caller with the gateway's own precedence (`selectPlugins`), listing the instances each winner replaces. A service's page shows that answer for its routes, and an upstream's page shows its health-check settings, its targets' share of the traffic, and when its algorithm runs as round-robin on Workers.
- 562c8ee: Each pending change (`GET /config/pending`) names who staged it (its entity's latest audit event) and carries the entity's name and route paths. The publish page groups changes by entity with added, changed and removed counts, puts removals first, searches names, paths and ids, and says that publishing takes every staged change, and whose.
  
  `GET /config/pending?warnings=true` adds what publishing now would warn about. The admin UI's certificate form takes private keys as vault references only, and says why; the certificate list reads each certificate's subject and expiry, flagging any expired or expiring within 14 days (`CERTIFICATES.expiryWarningDays`); the vaults page explains `env` and `cf-secrets-store`, builds a reference, and lists plain-text plugin secrets; the upload form shows the sandbox's limits and trust model and refuses limits above them.
  
  The developer portal gives an unverified email its own 403 detail (`portal_email_unverified`, separate from `portal_not_allowed`), and shows each refusal (blocked, not allowed, unverified, the key limit) as a message saying what happened and what to do, never naming the allowed domains.
- 562c8ee: Creating or updating an uploaded plugin with `cpu_ms` or `sub_requests` outside the sandbox's limits (1 to `SANDBOX.maxCpuMs` or `SANDBOX.maxSubRequests`) is a 400 `EDG-ADM-004` with an issue at that field, instead of being stored and clamped by the gateway.
  
  On a traced request, the gateway names the matched route (`x-edgway-route`) whether the upstream or a plugin answered, and records the upstream call in the trace (`TRACE.upstream`) with its own timing. The route tester names the route on a short-circuit too, and draws the upstream bar from that entry.
  
  The service page says a host is called directly only when the upstream lookup answers 404; any other failure shows the error state with a retry.
  
  `GET /audit-events` and `GET /config/pending` declare their response schemas, so the SDK types (and validates) `{ data, next? }` and `{ version?, changes, warnings? }`; the admin UI uses those types instead of its own copies.
  
  The portal's usage chart and the admin overview chart format their tooltip numbers in the UI's locale (`formatNumber`), and the portal's refusal store subscribes once instead of on every render.
- 562c8ee: `pnpm --filter @edgway/ui screens` seeds the e2e stack and writes a full-page screenshot of each admin screen to `apps/ui/screens/`, with an index naming each one's mockup, for the design check. `test:e2e` doesn't run it.
  
  The admin UI's shell follows the design: a full-height sidebar with "Jump to…", no icons and no Targets item, and the signed-in identity pinned to the bottom; the top bar no longer repeats the console pages. Form toolbars sit under their fields instead of over them. Titles are singular or the entity's own name ("Create route", "Upload a plugin", "httpbin"), arrays show as badges, and every field label comes from `@edgway/i18n`. Lists have a search box first (it filters the page shown), with tags behind "Add filter", Previous and Next page, and "Create …" as the primary action. The routes list adds service and method filters and a Plugins column. The route form puts Basics and "What it matches" in cards, with paths as chips, methods as checkboxes and the rest under a closed Advanced, beside a dark decK preview; the upload form takes its code from a file, with name, version and priority in a row and the limits as sliders.
  
  The service, upstream and consumer pages have their own layouts. A service shows its URL, "How requests reach it" (its routes, the service, then its upstream's targets or the host it calls directly) and "Which plugins run" as a table with each plugin's scope and effect, replaced ones struck through. An upstream shows the services using it, the algorithm note, its settings in brief, its targets with share bars and an inline "Stage target", and its health checks in words. A consumer shows its portal badges, Block or Unblock portal access, the details that are set, and its API keys, basic auth, JWT credentials, ACL groups (as removable chips) and plugins as cards. The native API's consumer reads add a read-only `portal: { developer, blocked }` (never the OIDC subject); the Kong-compatible API doesn't.
  
  The service form follows the route form's pattern: Basics, "Where it sends requests" (protocol, host, port, path), the rest under a closed Advanced, beside the decK preview.
- 562c8ee: The plugin form follows the design: "Where it applies" as radio cards with hints and the target picker under them; each catalog plugin's common fields first, grouped and labelled (for rate-limiting: the limits, count-by and counter store), with everything else under a closed "Advanced"; the dark decK preview; a "What callers see" note naming the status and error code a refused caller gets; and "Stage plugin" with the line that it goes live on publish.
  
  The publish page puts the staged changes first, grouped by entity in a card ("Staged against version N", JSON or decK YAML), beside a card with the note, the warnings publishing now would give, and "Publish version N". The side-by-side diff is folded until opened and shows only the changed entities; history is a card with "Roll back".
  
  The audit log names each event's entity ("route public-ip", "plugin rate-limiting on route httpbin-anything"): `GET /audit-events` adds `entity_name` and, for plugins, `scope`. It filters by who, action and entity, shows each action as a badge, and expands a row to its diff as removed and added lines, its request id and a link to the entity. The route tester shows the status as a badge with the matched route by name, the plugins' timings as a waterfall, and the response headers and body side by side.
  
  The vaults page shows the two built-in vaults as cards with their reference forms, a "Make a reference" card with a dark output and Copy, the vault entities in their own card, and the plugin secrets kept as plain text in a warning card with "Edit plugin". The certificates page shows the expiry banner, each certificate's subject and issuer, SNIs, key type and an expiry badge, with Replace or View, and an add form that reads the pasted PEM and takes the private key as a vault reference only.

### Patch Changes

- 562c8ee: Dependency security updates before the public release: zod 4.6.7 (GHSA-mrhx-c7xc-m3w5). The workspace also moves the docs site to next 16.4.3 and the admin UI to vite 8.3.5, and raises the overrides for transitive dompurify, vite, zod, toml and undici so `pnpm audit --prod --audit-level high` passes again.
