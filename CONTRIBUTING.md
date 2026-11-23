# Contributing to Edgway

Thanks for helping. Edgway is an Apache-2.0, Kong-compatible API gateway on Cloudflare Workers. This guide covers setting up the repository, the rules every change follows, and how a change gets merged.

By taking part you agree to the [Code of Conduct](./CODE_OF_CONDUCT.md). **Report security issues privately** (see [SECURITY.md](./SECURITY.md)), never in an issue or pull request.

## Before you start

- **Bugs and features:** open an issue first for anything larger than a small fix, so we can agree on the approach. The issue templates ask for what we need.
- **Kong compatibility:** Edgway follows the Kong 3.9 OSS Admin API and decK. A difference from Kong is a bug unless the [compatibility page](./apps/docs/content/docs/operations/compatibility.mdx) lists it.
- **The spec:** [`docs/PRD.md`](./docs/PRD.md) is the design. A change that goes against it needs a discussion in an issue first.

## Set up

You need:

- **Node.js 22.** `.nvmrc` pins it, so run `nvm use` or `fnm use`.
- **pnpm 10.** Run `corepack enable`; the root `package.json` pins the version.
- **Git**, and a POSIX shell for the scripts. On Windows, use WSL.

Optional:

- A Cloudflare account and `npx wrangler login`, for a real deploy.
- Playwright's Chromium (`pnpm --filter @edgway/ui exec playwright install chromium`), for the UI and portal end-to-end suites.
- Terraform 1.6 or later, for `infra/terraform`.

wrangler, workerd and every other tool are workspace dependencies. decK is downloaded, checksum-verified, by the script that needs it.

```bash
pnpm install
pnpm test                          # every package; Workers code runs in workerd
pnpm gate                          # everything CI's main job checks
```

## Local development

- **Run the admin and gateway together:** `bash tools/kong-compat-e2e.sh` is the shortest path to a running stack. It:
  - applies the D1 migrations to local state;
  - starts the admin and the gateway with `wrangler dev` on shared state, with throwaway signing keys and a Kong-Admin-Token;
  - syncs `examples/deck/demo.yaml` with decK, publishes it, and calls the gateway.

  Read the script to reuse its setup by hand.
- **One Worker:** copy its `.dev.vars.example` to `.dev.vars` (gitignored), fill it in, and run `pnpm --filter @edgway/admin dev` (or `@edgway/gateway`; the portal Worker runs with `pnpm --filter @edgway/portal exec wrangler dev`).
  - The admin's native API (`/api/v1`) checks Cloudflare Access, so locally it is easiest to work through the Kong-compatible Admin API with a `Kong-Admin-Token`.
- **The admin UI and the portal:**
  - `pnpm --filter @edgway/ui dev` and `pnpm --filter @edgway/portal dev`;
  - their Playwright suites (`test:e2e`) start every Worker they need in Miniflare, so they are also the reference for a local setup.
- **Docs:**
  - `pnpm --filter @edgway/docs dev`;
  - the error, plugin and admin API reference pages are generated (`pnpm --filter @edgway/docs generate`).

## Rules every change follows

[`CLAUDE.md`](./CLAUDE.md) holds the standing rules. The ones that matter most:

- **Reuse before writing code.** Take a capability from, in this order:
  1. an existing MIT, Apache-2.0, BSD or ISC library;
  2. Kong's own OSS artifacts (plugin schemas, decK);
  3. a Cloudflare product behind an adapter in `@edgway/adapters-cf`;
  4. new code only, as a last resort.

  New code under `apps/*/src`, `packages/*/src` or `plugins/*/src` must be claimed in [`docs/custom-code-register.yaml`](./docs/custom-code-register.yaml), with the reason. A new dependency must be in the PRD's build-vs-reuse matrix. Never add AGPL code to anything that ships.
- **Every shared value has one home:**
  - header names, KV keys, limits and defaults in `@edgway/constants`;
  - error codes in `@edgway/errors`;
  - user-facing strings in `@edgway/i18n` (message keys only, never literals in JSX);
  - metric and log fields in `@edgway/telemetry`;
  - schemas in `@edgway/schema`.
- **Packages talk through their `exports`.** `apps/*` only wire packages together, and nothing imports an app.
- **Generated code is regenerated, never edited:** the SDK, the zod schemas from Kong's JSON Schemas, the i18n catalogs, the docs references, `apps/admin/openapi.json`, the plugin registries and `THIRD_PARTY_NOTICES.txt`. `pnpm drift` fails if any generated file is out of date.
- **Platform limits:**
  - stream request and response bodies on the proxy path (Workers isolates have 128 MB);
  - nothing on the gateway's request path reads D1;
  - secrets never go in `wrangler.jsonc` `vars` or in D1.
- **Exact pins:** pre-1.0 dependencies (Zudoku, `@hey-api/openapi-ts`, citty) and vitest (4.x) are pinned to exact versions.

## Checks

| Check | Command | Run by |
| --- | --- | --- |
| Typecheck, lint and unit tests | `pnpm turbo run typecheck lint test` | `pnpm gate`, and CI's `check` job |
| Formatting and lint (Biome) | `pnpm check`, or `pnpm format` to fix | `pnpm gate`, and CI's `check` job |
| Gates (`tools/gates/gates.json`) | `pnpm gate:<name>`: `boundaries`, `register`, `knip`, `i18n`, `centralization`, `licences`, `audit` | `pnpm gate`, and CI's `check` job |
| Generated files are current | `pnpm drift` | CI's `drift` job |
| Docs site builds, links resolve | `pnpm --filter @edgway/docs build` | CI's `docs` job |
| Published packages | `node tools/release/check-packs.mjs` | CI's `pack` job |
| End-to-end suites | `pnpm --filter @edgway/ui test:e2e`, `pnpm --filter @edgway/portal test:e2e` | CI's `e2e` job |
| Workflow files | `actionlint` ([rhysd/actionlint](https://github.com/rhysd/actionlint), the version pinned in `ci.yml`) | CI's `actionlint` job |
| Gate self-tests | `pnpm gate:test` | Run it yourself when you change a gate |

Before you open a pull request, run `pnpm gate`, plus `pnpm drift` if you touched anything a generator reads.

Notes:

- `audit` (`pnpm audit --prod --audit-level high`) is the one gate that needs the network. Everything else, including the portal build, works offline.
- **A gate is never disabled, skipped or weakened to make a change pass.** If a gate is wrong, open an issue.

## Packages and releases

- **Built packages:** the public packages (`packages/*` except `admin-core`, `kong-compat`, `tokens` and `ui-kit`, every `plugins/*`, and the `edgway` CLI) are published to npm. Inside the workspace their `exports` point at `src/*.ts`. When packed, `prepack`:
  - builds `dist` with `tsc -b tsconfig.build.json`;
  - copies the repository's LICENSE and NOTICE;
  - `publishConfig` then points the exports at `dist/*.js` and `.d.ts`.
- **Relative imports** in `packages/*/src` and `plugins/*/src` end in `.js` (Biome's `useImportExtensions` checks this), so the emitted ESM runs under Node.
- **Changesets:** a change to a published package needs one. Run `pnpm changeset`, pick the packages and the bump, and describe the change for users. Mark a breaking change clearly.
- **Releasing:** maintainers release from `main`. `.github/workflows/release.yml` opens a "Version Packages" pull request; merging it publishes to npm with provenance.

## Pull requests

- Keep a pull request to one change, with tests. The template's checklist mirrors the checks above.
- Write commit messages that say what changed and why.
- **Sign off every commit** (below). A maintainer reviews every pull request (`.github/CODEOWNERS`), and CI must be green before it merges.

### Developer Certificate of Origin

Edgway uses the [Developer Certificate of Origin](https://developercertificate.org/) (DCO 1.1) instead of a CLA. By signing off a commit, you certify that you wrote the change, or otherwise have the right to submit it under the project's license (Apache-2.0).

Add the sign-off with `git commit -s`, which appends:

```
Signed-off-by: Your Name <you@example.com>
```

Use your real name and an email you can be reached at. To sign off commits you've already made, run `git rebase --signoff main` and force-push your branch.

The [DCO app](https://github.com/apps/dco) checks every commit in a pull request and reports a `DCO` status; a pull request can't merge until it passes.
