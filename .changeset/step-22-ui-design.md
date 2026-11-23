---
"@edgway/constants": minor
"@edgway/sdk": minor
"@edgway/i18n": minor
---

`GET /audit-events` filters by `actor`, `action` and `entity_type` and pages with a cursor (`next`), newest first; the page size defaults to 50, at most 200 (`AUDIT_PAGE`). The admin UI has an Audit log page: who changed what and when, filtered by action, each event expanding to its diff and request id, with links to the entity or the published version.

The admin refuses a route path that doesn't start with `/` (or `~` for a regular expression, as Kong requires), naming the path. The route and service forms group their fields (basics, what a route matches, advanced), show the admin's field errors under the field, preview the entity as decK YAML, and say "Stage route" or "Stage service". A service's page shows the upstream its host names, with each target's share of the traffic.

`GET /which-plugins?route=…&consumer=…|consumer_group=…` answers which plugins run for a route and a caller with the gateway's own precedence (`selectPlugins`), listing the instances each winner replaces. A service's page shows that answer for its routes, and an upstream's page shows its health-check settings, its targets' share of the traffic, and when its algorithm runs as round-robin on Workers.
