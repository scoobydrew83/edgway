---
"@edgway/i18n": minor
"@edgway/adapters-cf": minor
"@edgway/constants": minor
"@edgway/sdk": minor
---

Creating or updating an uploaded plugin with `cpu_ms` or `sub_requests` outside the sandbox's limits (1 to `SANDBOX.maxCpuMs` or `SANDBOX.maxSubRequests`) is a 400 `EDG-ADM-004` with an issue at that field, instead of being stored and clamped by the gateway.

On a traced request, the gateway names the matched route (`x-edgway-route`) whether the upstream or a plugin answered, and records the upstream call in the trace (`TRACE.upstream`) with its own timing. The route tester names the route on a short-circuit too, and draws the upstream bar from that entry.

The service page says a host is called directly only when the upstream lookup answers 404; any other failure shows the error state with a retry.

`GET /audit-events` and `GET /config/pending` declare their response schemas, so the SDK types (and validates) `{ data, next? }` and `{ version?, changes, warnings? }`; the admin UI uses those types instead of its own copies.

The portal's usage chart and the admin overview chart format their tooltip numbers in the UI's locale (`formatNumber`), and the portal's refusal store subscribes once instead of on every render.
