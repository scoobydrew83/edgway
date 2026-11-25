# @edgway/plugin-jwt

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

### Patch Changes

- 562c8ee: Dependency security updates before the public release: zod 4.6.7 (GHSA-mrhx-c7xc-m3w5). The workspace also moves the docs site to next 16.4.3 and the admin UI to vite 8.3.5, and raises the overrides for transitive dompurify, vite, zod, toml and undici so `pnpm audit --prod --audit-level high` passes again.
- Updated dependencies [562c8ee]
  - @edgway/plugin-sdk@0.1.0
  - @edgway/schema@0.1.0
  - @edgway/constants@0.1.0
  - @edgway/core@0.1.0
  - @edgway/errors@0.1.0
