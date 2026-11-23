---
"@edgway/schema": patch
"@edgway/core": patch
"@edgway/adapters-cf": patch
"@edgway/constants": patch
"@edgway/i18n": patch
"@edgway/plugin-ai-proxy": patch
"@edgway/plugin-response-transformer": patch
---

Open-source readiness (Steps 14–15):

- `@edgway/schema`, `@edgway/core` and `@edgway/adapters-cf` ship the licence texts of the code they copy from Kong (`third-party/`), and the files ported from Kong 3.9's Lua say so.
- `@edgway/constants` adds `PORTAL.listSeparator` and `PORTAL.notAllowedDetail` for the portal's new `PORTAL_ALLOWED_EMAIL_DOMAINS` sign-up allow-list.
- `@edgway/i18n` and the ai-proxy and response-transformer READMEs drop internal decision tags.
