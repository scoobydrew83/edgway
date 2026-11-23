#!/usr/bin/env node
/**
 * `pnpm run deploy` (and the Deploy to Cloudflare button, docs/deploy.md):
 * builds the edgway CLI and runs `edgway deploy` on this repo, the one
 * implementation of the deploy (apps/cli/src/deploy.ts). Pass
 * `--dry-run` to bundle and check the three Workers without touching
 * anything remote.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(repo, "apps/cli");

/** Runs node with `args` in the repo; exits with its status on failure. */
function node(args) {
  const { status } = spawnSync(process.execPath, args, {
    cwd: repo,
    stdio: "inherit",
  });
  if (status !== 0) process.exit(status ?? 1);
}

node([path.join(cli, "scripts/build.mjs")]);
node([
  path.join(cli, "dist/index.js"),
  "deploy",
  "--cwd",
  repo,
  ...process.argv.slice(2),
]);
