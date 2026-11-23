---
---

The native admin API (`/api/v1`) refuses a request body with a field the entity doesn't take, with a 400 (`EDG-ADM-004`) whose `issues` name the field. Before, the field was silently dropped: a route posted with Kong's `service: { id }` was stored without a service. Kong's shapes still work on the Kong-compatible mount.

Managed fields (`created_at`, `updated_at`, `workspace_id`) and internal fields are refused the same way, so a fetched row can't be sent back as-is: drop them first.

Docs: a Worker upstream on the gateway's zone (any of your `*.workers.dev` Workers) needs a Service Binding, since Cloudflare answers its URL with `error code: 1042`; and how to tell the Access application covers the Kong mount.
