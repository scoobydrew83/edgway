---
"edgway": minor
"@edgway/adapters-cf": minor
"@edgway/constants": minor
"@edgway/core": minor
"@edgway/errors": minor
"@edgway/i18n": minor
"@edgway/plugin-sdk": minor
"@edgway/schema": minor
"@edgway/sdk": minor
"@edgway/telemetry": minor
"@edgway/plugin-acl": minor
"@edgway/plugin-ai-prompt-guard": minor
"@edgway/plugin-ai-proxy": minor
"@edgway/plugin-ai-rate-limiting-advanced": minor
"@edgway/plugin-basic-auth": minor
"@edgway/plugin-correlation-id": minor
"@edgway/plugin-cors": minor
"@edgway/plugin-http-log": minor
"@edgway/plugin-ip-restriction": minor
"@edgway/plugin-jwt": minor
"@edgway/plugin-key-auth": minor
"@edgway/plugin-openid-connect": minor
"@edgway/plugin-proxy-cache": minor
"@edgway/plugin-rate-limiting": minor
"@edgway/plugin-request-size-limiting": minor
"@edgway/plugin-request-termination": minor
"@edgway/plugin-request-transformer": minor
"@edgway/plugin-response-transformer": minor
---

Audit fixes (Step 12) and pre-release fixes (Step 13), towards the first public release, 0.1.0.

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
