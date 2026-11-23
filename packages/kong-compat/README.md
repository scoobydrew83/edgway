# @edgway/kong-compat

The Kong 3.9 Admin API surface that [decK](https://github.com/Kong/deck) and Kong's Terraform provider call, served from `@edgway/admin-core`. `apps/admin` mounts it at `/`, behind `Kong-Admin-Token` authentication.

## Read endpoints

- `GET /` reports Kong `3.9.0` with `configuration.database: "postgres"`, so decK uses the per-entity endpoints. `GET /status` is also served.
- Collections are served as `{ data, next, offset }` pages, with `size`, `offset` and `tags` (`a,b` matches all, `a/b` matches any):
  - `services`, `routes`, `plugins`, `consumers`, `consumer_groups`, `upstreams`, `certificates`, `ca_certificates`, `snis`, `vaults`;
  - credentials: `key-auths`, `basic-auths`, `jwts`, `acls`.
- Any entity can be fetched with `GET /{collection}/{id or name}`.
- Nested collections: `/services/{id}/routes`, `/{services,routes,consumers}/{id}/plugins`, `/upstreams/{id}/targets`, and `/consumers/{id}/{key-auth,basic-auth,jwt,acls}`.
- Collections Edgway has no entity for return empty pages: `key-sets`, `keys`, `hmac-auths`, `mtls-auths`, `oauth2`, `partials`, `filter-chains`, `degraphql_routes`.
- `GET /schemas/{entity}` and `GET /schemas/plugins/{name}` return schemas in Kong's `fields` format, which decK uses to fill defaults. Plugin schemas come from Kong's vendored JSON Schemas. Entity schemas come from the D1 tables' Kong defaults.

## Write endpoints

Writes are staged in D1 through admin-core, like native API writes, and audited. Nothing reaches the gateway until a publish. They need a token with the `editor` role.

- `POST /{collection}` creates (201). `PUT /{collection}/{id or name}` upserts: it replaces the entity, resetting omitted fields to their defaults, or creates it with that id or name (200). `PATCH` merges (200; 404 when missing). `DELETE` answers 204 whether or not the entity existed.
- The same four methods work on every nested collection above (`POST /services/{s}/routes`, `PUT /consumers/{c}/key-auth/{id}`, …), with the parent's reference set from the path. Targets are found by id or `host:port` within their upstream.
- References are accepted as `{ "id": … }`, `{ "name": … }` (or `username`), or a bare id. A service `url` is split into `protocol`, `host`, `port` and `path`.
- Consumer-group membership: `GET`, `POST` (`{"consumer": …}`, one or a list) and `DELETE /consumer_groups/{g}/consumers/{c}`, and the same from the consumer side under `/consumers/{c}/consumer_groups` (`{"group": …}`).
- Plugins are validated as Kong does at write time: a plugin without an entry in Edgway's schema registry answers Kong's 400 `plugin not enabled` (EDG-ADM-008), and an invalid config answers 400. Nulls in a config (decK sends unset fields as null) are dropped. A `PATCH` merges into the stored config.
- Errors use Kong's `{"message": …}` shape. An unknown path is a JSON 404, as in Kong.

`apps/admin` adds `POST /edgway/publish` (the `publisher` role), so CI can publish after `deck gateway sync`.

## Differences from Kong

- **Certificate keys:** a certificate's `key` and `key_alt` must be vault references (`{vault://env/…}`), as jwt secrets must; D1 never holds a private key. decK files with inline PEM keys are refused for those certificates (and their SNIs).
- **`preserve_host`:** not possible on Workers: the runtime takes a subrequest's Host from its URL (verified in workerd by the adapters-cf tests), so the upstream sees the service's host. The client's host reaches it in `X-Forwarded-Host`.
- **`path_handling`:** both `v0` and `v1` follow Kong 3.9's traditional router, Kong's own path-handling table included.
- **key-auth keys:** Edgway stores only a SHA-256 hash and never returns the key. Reads carry a placeholder, `edgway-hashed:<id>`, because decK indexes credentials by key. decK therefore plans a delete and create for every key-auth in a file on each diff or sync, and syncing converges to the file's key. Writing the placeholder back keeps the stored key. Only the key can change on an existing credential: changing its `tags` or `ttl` answers 400.
- **basic-auth passwords:** the hashed password is never returned. decK itself warns that basic-auth credentials don't round-trip, even against Kong.
- **JWT secrets** must be `{vault://…}` references: secrets never go in D1. A raw `secret` answers 400.
- **Plugins without an Edgway package** (e.g. `hmac-auth`, `prometheus`) answer "plugin not enabled", and their credential endpoints answer 404.
- **Enterprise collections:** workspaces, RBAC and the other Enterprise-only collections are not served.
- **Workspaces:** only Kong's `default` workspace exists. Every path is also served under `/default/` (Kong OSS does the same, and Kong's Terraform provider uses those paths); any other workspace answers 404.
