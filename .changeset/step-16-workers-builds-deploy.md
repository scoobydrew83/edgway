---
"@edgway/constants": patch
"edgway": patch
---

`edgway deploy` works under Workers Builds (the Deploy to Cloudflare button): it runs wrangler without Workers Builds' `WRANGLER_CI_OVERRIDE_NAME` and `WRANGLER_CI_MATCH_TAG`, so each Worker deploys under the name in its own config instead of the name of the Worker the build is connected to.
