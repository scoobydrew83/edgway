/**
 * Types for tools/wrangler-config.mjs, for its TypeScript callers. Each
 * export is `@public`: TypeScript resolves the callers' `.mjs` import here,
 * but knip follows it to the `.mjs`.
 */

/** The fields of a wrangler config the helper and its callers read. */
export interface RawConfig {
  main?: string;
  d1_databases?: { migrations_dir?: string }[];
  durable_objects?: { bindings?: { script_name?: string }[] };
  assets?: { directory?: string };
  build?: object;
}

/** @public */
export type ReadRawConfig = (options: { config: string }) => {
  rawConfig: RawConfig;
};

/** @public */
export function derivedConfig(options: {
  readRawConfig: ReadRawConfig;
  config: string;
  file: string;
  edit?: (raw: RawConfig) => Record<string, unknown>;
}): string;

/** @public */
export function adminWithoutServices(options: {
  readRawConfig: ReadRawConfig;
  config: string;
  file: string;
}): string;
