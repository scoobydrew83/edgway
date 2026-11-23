---
"@edgway/adapters-cf": minor
"@edgway/constants": minor
"@edgway/core": minor
---

Step 10 follow-ups (Step 11):

- Service tags reach only bindings named `UPSTREAM_*`, and `{vault://env/…}` reads only names starting with `VAULT_`. Rename existing upstream bindings and vault secrets, and update the tags and references to match.
- A route's `https_redirect_status_code` (301, 302, 307 or 308) redirects plain HTTP to HTTPS; any other value answers 426, without naming the route.
- `X-Forwarded-Proto`, `X-Forwarded-Host`, `X-Forwarded-Port` and `X-Real-IP` are set upstream, as Kong sets them.
- Balancer state (round-robin position, passive health) carries over a publish that leaves an upstream and its targets unchanged.
- `isVaultReference` is exported from `@edgway/adapters-cf/secrets`.
