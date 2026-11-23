/**
 * Derived wrangler configs: a copy of a Worker's config with
 * some bindings left out, for where they can't resolve. A Worker can't bind
 * one that isn't deployed yet (tools/deploy.mjs), and `unstable_startWorker`
 * can't resolve one Worker's bindings to another's (the UI e2e, the CLI test,
 * the Terraform local admin). Paths are made absolute, so the copy can be
 * written anywhere.
 *
 * Wrangler's `experimental_readRawConfig` is passed in: each caller resolves
 * wrangler its own way (the admin's dependency, or its own).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * @typedef {import("./wrangler-config.d.mts").RawConfig} RawConfig
 * @typedef {(options: { config: string }) => { rawConfig: RawConfig }} ReadRawConfig
 */

/**
 * Write `config` (a wrangler.jsonc) to `file` with `edit`'s fields applied.
 * @param {{
 *   readRawConfig: ReadRawConfig,
 *   config: string,
 *   file: string,
 *   edit?: (raw: RawConfig) => Record<string, unknown>,
 * }} options
 * @returns {string} `file`
 */
export function derivedConfig({ readRawConfig, config, file, edit }) {
  const { rawConfig } = readRawConfig({ config });
  // Absolute, so the copy works wherever it is written.
  const dir = path.dirname(path.resolve(config));
  /** @param {string | undefined} p */
  const at = (p) => (p ? path.resolve(dir, p) : p);
  const copy = {
    ...rawConfig,
    $schema: undefined,
    main: at(rawConfig.main),
    d1_databases: rawConfig.d1_databases?.map(
      /** @param {{ migrations_dir?: string }} db */
      (db) => ({ ...db, migrations_dir: at(db.migrations_dir) }),
    ),
    assets: rawConfig.assets && {
      ...rawConfig.assets,
      directory: at(rawConfig.assets.directory),
    },
    build: rawConfig.build && { ...rawConfig.build, cwd: dir },
    ...edit?.(rawConfig),
  };
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(copy));
  return file;
}

/**
 * The admin's config without its `services` (the GATEWAY binding, Drew):
 * deployed first, before the gateway exists, and started locally,
 * where the route tester reaches the gateway through GATEWAY_URL.
 * @param {{ readRawConfig: ReadRawConfig, config: string, file: string }} options
 * @returns {string} `file`
 */
export const adminWithoutServices = (options) =>
  derivedConfig({ ...options, edit: () => ({ services: undefined }) });
