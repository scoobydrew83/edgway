# Vendored Kong schemas

Machine-readable schemas copied byte-for-byte from Kong's open-source repositories at pinned commits. Don't edit these files: re-run `pnpm tsx tools/vendor-kong-schemas.ts`, and check them with `--check`.

| Files | Source repository | Commit | Licence |
| --- | --- | --- | --- |
| `3.9/plugins/*.json` | [Kong/developer.konghq.com](https://github.com/Kong/developer.konghq.com), `app/_schemas/gateway/plugins/3.9/` | `8cf54cb5f437df50f89d37192fb17a8af71cf1a4` | MIT |
| `deck/kong_json_schema.json` | [Kong/go-database-reconciler](https://github.com/Kong/go-database-reconciler), `pkg/file/kong_json_schema.json` | `04b4e6a01d4a182cc432406d708f8c3220b9125e` | Apache-2.0 |

## Plugins (Kong Gateway 3.9)

All PRD v1 plugins have a 3.9 schema, so no later-version fallbacks were needed.

| Kong plugin | Source file | Note |
| --- | --- | --- |
| key-auth | KeyAuth.json | |
| jwt | Jwt.json | |
| basic-auth | BasicAuth.json | |
| openid-connect | OpenidConnect.json | Kong Enterprise plugin; the schema is public |
| acl | Acl.json | |
| cors | Cors.json | |
| ip-restriction | IpRestriction.json | |
| rate-limiting | RateLimiting.json | |
| request-size-limiting | RequestSizeLimiting.json | |
| request-transformer | RequestTransformer.json | |
| response-transformer | ResponseTransformer.json | |
| proxy-cache | ProxyCache.json | |
| request-termination | RequestTermination.json | |
| correlation-id | CorrelationId.json | |
| http-log | HttpLog.json | |
| ai-proxy | AiProxy.json | |
| ai-rate-limiting-advanced | AiRateLimitingAdvanced.json | The PRD calls this `ai-rate-limiting`. Kong's plugin name is `ai-rate-limiting-advanced` (Enterprise); vendored under Kong's name so decK files match. Drew (2026-09-29): Edgway uses Kong's name. |
| ai-prompt-guard | AiPromptGuard.json | |

The decK file schema is JSON Schema draft-04. Its `config` members are open (`additionalProperties: true`), so per-plugin validation uses the plugin schemas above.
