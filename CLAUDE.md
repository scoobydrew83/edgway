# Edgway: rules for every change

Edgway is an open-source, Kong-compatible API gateway on Cloudflare Workers. The spec is `docs/PRD.md` (v2).

## 1. Never hand-roll: the reuse ladder

Source every capability in this order, and write down why you skipped a rung:

1. An existing OSS library (MIT, Apache-2.0, BSD or ISC; never AGPL in shipped code).
2. Kong's own OSS artifacts: plugin JSON Schemas, the decK file schema, Admin API contracts, the `deck` CLI.
3. A Cloudflare managed product, **behind an adapter** in `@edgway/adapters-cf`.
4. Custom code, **only** if it is listed in `docs/custom-code-register.yaml` with a reason.

The PRD's "Build vs. reuse matrix" is the approved dependency list. A dependency not in the matrix needs a maintainer's approval.

## 2. Everything is a package; shared values live in one place

- `apps/*` only wire packages together. They import `packages/*`, `plugins/*` and npm. Nothing imports an app.
- Import other workspace packages only through their `exports` entry points. No `../../packages/x/src/...`.
- Every shared value has one home. Never inline it anywhere else:

| Kind of value | Home |
| --- | --- |
| Header names, KV key formats, limits, defaults | `@edgway/constants` |
| Error codes, statuses, problem+json bodies | `@edgway/errors` |
| User-facing strings | `@edgway/i18n` (message keys only) |
| Metric and log field names | `@edgway/telemetry` |
| Entity and plugin schemas | `@edgway/schema` |
| Colors and spacing | `@edgway/tokens` |

- Generated code (the SDK, zod generated from Kong schemas, compiled FormatJS catalogs) is never edited by hand. Regenerate it instead.

## 3. Gates are law

- `pnpm gate` runs every enabled gate listed in `tools/gates/gates.json`.
- A gate is never disabled, skipped, weakened or marked `--no-verify` to make work pass.
- Enabling a gate, changing a gate's config or changing the custom-code register needs a maintainer's approval in the pull request.

## 4. Platform rules

- Stream bodies; never `arrayBuffer()` a request or response in the proxy path. Isolates have 128 MB.
- Nothing on the gateway request path reads D1 or calls the admin Worker.
- Secrets never go in `wrangler.jsonc` `vars` or in D1.
- Pin exact versions for pre-1.0 dependencies (Zudoku, `@hey-api/openapi-ts`, citty) and for vitest (4.x; the Workers pool does not support 5 yet).

## 5. Git

- Work on a branch, never `main`. Changes reach `main` only through a pull request.
- Sign off every commit (`git commit -s`); see the DCO section of `CONTRIBUTING.md`.
