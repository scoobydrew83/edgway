# edgway

The Edgway command line. Run it from an Edgway project (this repository, or a copy made with the Deploy to Cloudflare button).

| Command | What it does |
| --- | --- |
| `edgway init` | Writes `edgway.config.ts`: the admin URL and the two Workers' wrangler configs. Prompts with @clack/prompts; `--yes` takes the defaults. |
| `edgway deploy` | Applies the admin's D1 migrations remotely, then deploys the admin and the gateway with wrangler. `--dry-run` bundles and checks both Workers and touches nothing remote. |
| `edgway import-deck <file>` | Offline. Validates a decK file against decK's schema, migrates the admin's **local** D1 (wrangler's state, or `--persist-to`), and writes every entity through the same Kong-compatible service layer as the live admin. Entities with an id or a unique name are upserted, so re-importing is safe. Online, `deck gateway sync` does the same against a running admin. |
| `edgway diff` | The staged changes the next publish would make. |
| `edgway publish [--note]` | Publishes the staged configuration (needs the `publisher` role). |
| `edgway plugin new <name>` | Scaffolds `plugins/<name>`: a `definePlugin()` module, a test on the plugin-sdk test kit, a README and the package configs. |

`diff` and `publish` call the admin API through `@edgway/sdk`. The admin URL comes from `--admin-url`, `EDGWAY_ADMIN_URL` or `edgway.config.ts`. The admin sits behind Cloudflare Access: set `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET` (a service token with an admin role), or pass an Access assertion with `--token` or `CF_ACCESS_TOKEN`, for a local admin.

Every message the CLI prints comes from the `@edgway/i18n` catalog.

## Development

The CLI runs wrangler (`deploy`, `import-deck`), and wrangler is a **peer dependency**: install it next to the CLI (`npm install --save-dev edgway wrangler`). A project that deploys Workers usually has it already.

`pnpm --filter edgway build` bundles `src/` into `dist/index.js` with esbuild. The workspace packages are inlined; the npm dependencies and peer dependencies listed in `package.json` stay external. The build also writes `dist/THIRD_PARTY_NOTICES.txt` (the production dependencies' licences, from `tools/licenses/notices.ts`) and keeps bundled licence comments in `dist/index.js.LEGAL.txt`. `pnpm --filter edgway test` builds, then runs each command against a real admin Worker started with wrangler's `unstable_startWorker`, with Cloudflare Access stubbed by a test key.
