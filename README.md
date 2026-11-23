# Edgway

An open-source, Kong-compatible API gateway that runs on **Cloudflare Workers**.

> **Status:** early build. The design is in [`docs/PRD.md`](./docs/PRD.md).

**License:** Apache-2.0 (see [LICENSE](./LICENSE) and [NOTICE](./NOTICE)). Edgway is not affiliated with Kong Inc.

## Deploy

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/scoobydrew83/edgway)

Edgway is three Workers (the admin, the gateway and the developer portal) in one monorepo, and Cloudflare's Deploy button deploys only one Worker per repository on its own. The root `wrangler.jsonc` exists only so the button accepts the repository: it copies the repository to your account, connects it to Workers Builds and pre-fills the deploy command from the root `package.json`, `pnpm run deploy`, which deploys all three. Clear the suggested build command. The button path is still waiting on its first end-to-end run on a fresh account; from a terminal, `pnpm install && pnpm run deploy` is the tested path.

The deploy script provisions the KV namespace and the D1 database, runs the migrations, deploys the three Workers and creates the snapshot-signing keys. [`docs/deploy.md`](./docs/deploy.md) covers the steps, the Cloudflare Access setup that follows, and the timed walkthrough.

## Repository layout

```
edgway/
  apps/
    gateway/           data-plane Worker
    admin/             control-plane Worker: native API (/api/v1) and the Kong-compatible mount
    cli/               the `edgway` CLI
  packages/            shared packages (core, schema, admin-core, kong-compat, sdk, ...)
  plugins/             one package per gateway plugin
  docs/                PRD v2, restructure plan, deploy guide
  tools/               gates, the deploy script, the decK end-to-end check
```

A pnpm workspace, orchestrated by Turborepo, with Biome for formatting and linting and Changesets for releases.

## Prerequisites

- **Node.js 22.** `.nvmrc` pins it, so run `nvm use` or `fnm use`.
- **pnpm 10.** Run `corepack enable`; `packageManager` pins the version.
- **A Cloudflare account**, for deploying. Run `npx wrangler login` once.
- **Optional:**
  - decK, for migrating from Kong (`tools/kong-compat-e2e.sh` downloads a checksum-verified copy for its own run);
  - Terraform 1.6 or later, for `infra/terraform`;
  - Playwright's Chromium, for the end-to-end suites.

## Quick start (local)

```bash
pnpm install
pnpm test                        # every package, Workers tests in workerd
pnpm gate                        # the repository gates (tools/gates/gates.json)
pnpm run deploy -- --dry-run     # bundle and check the three Workers
bash tools/kong-compat-e2e.sh    # decK against a local admin and gateway
```

`tools/kong-compat-e2e.sh` is also the quickest look at a running local stack. It:
1. starts the admin and the gateway with `wrangler dev` on shared local state;
2. syncs `examples/deck/demo.yaml` with decK;
3. publishes it and calls the gateway.

To run one Worker yourself, copy its `.dev.vars.example` to `.dev.vars` and run `pnpm --filter @edgway/admin dev` (or `@edgway/gateway`). [CONTRIBUTING.md](./CONTRIBUTING.md) covers the admin UI, the portal and the docs site.

## Documentation

The docs site (`apps/docs`, `pnpm --filter @edgway/docs dev`) has:

- **guides:** getting started, migrating from Kong, the admin UI, the developer portal, the CLI, vault references and sandbox plugins;
- **operations pages:** upgrades and migrations, backup and restore, compatibility, privacy and runbooks;
- **generated references** for every plugin, every error code and the admin API.

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md):
- setup;
- the rules every change follows (reuse before writing code, one home for shared values, gates that are never weakened);
- the checks CI runs;
- how to sign off commits (DCO).

Everyone taking part follows the [Code of Conduct](./CODE_OF_CONDUCT.md).

## Security

To report a vulnerability, see [SECURITY.md](SECURITY.md). Report it privately through GitHub's security advisories, never in a public issue.

## License

Apache-2.0. See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
