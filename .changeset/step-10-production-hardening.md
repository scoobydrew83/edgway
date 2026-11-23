---
"@edgway/adapters-cf": minor
"@edgway/constants": minor
"@edgway/core": minor
"@edgway/errors": minor
"@edgway/i18n": minor
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
"@edgway/plugin-sdk": minor
"@edgway/schema": minor
"@edgway/sdk": minor
"@edgway/telemetry": minor
"edgway": minor
---

Production hardening (Step 10, the 2026-10-03 audit), first published release:

- Vault references: `{vault://env/…}` and `{vault://cf-secrets-store/…}` resolve on the gateway, and secrets never reach D1. A secret that doesn't resolve fails its plugin closed.
- Fail closed: an enabled plugin the gateway doesn't bundle refuses its routes, and a plugin's `on_error` comes from the published config.
- Consumer groups scope plugins. Client-sent `X-Consumer-*` and `X-Authenticated-*` headers are always removed. Authentication plugins follow Kong's anonymous logical OR.
- Publish integrity: every publish goes through the ConfigVersion Durable Object, and the gateway reads the live version from it.
- The AI plugins (ai-proxy, ai-prompt-guard, ai-rate-limiting-advanced) run in the gateway with Workers AI and a Durable Object token counter. `@ai-sdk/openai` is dropped.
- Upstreams: Kong upstreams and targets are balanced, and Service Binding and Workers VPC targets are selected by service tags.
- Kong route `protocols` (426 for plain HTTP on an https-only route), and `X-Forwarded-For` is appended. `x-edgway-route` is sent only on traced requests.
- Packages ship their source only (`files`). `@edgway/telemetry` is public, and `@edgway/sdk` pins wrangler 4.124.0.
