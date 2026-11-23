---
"@edgway/plugin-sdk": patch
"@edgway/schema": patch
"@edgway/sdk": patch
"@edgway/plugin-acl": patch
"@edgway/plugin-ai-prompt-guard": patch
"@edgway/plugin-ai-proxy": patch
"@edgway/plugin-ai-rate-limiting-advanced": patch
"@edgway/plugin-basic-auth": patch
"@edgway/plugin-correlation-id": patch
"@edgway/plugin-cors": patch
"@edgway/plugin-http-log": patch
"@edgway/plugin-ip-restriction": patch
"@edgway/plugin-jwt": patch
"@edgway/plugin-key-auth": patch
"@edgway/plugin-openid-connect": patch
"@edgway/plugin-proxy-cache": patch
"@edgway/plugin-rate-limiting": patch
"@edgway/plugin-request-size-limiting": patch
"@edgway/plugin-request-termination": patch
"@edgway/plugin-request-transformer": patch
"@edgway/plugin-response-transformer": patch
---

Dependency security updates before the public release: zod 4.6.7 (GHSA-mrhx-c7xc-m3w5). The workspace also moves the docs site to next 16.4.3 and the admin UI to vite 8.3.5, and raises the overrides for transitive dompurify, vite, zod, toml and undici so `pnpm audit --prod --audit-level high` passes again.
