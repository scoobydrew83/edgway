/**
 * Static plugin registry codegen: reads the plugin packages listed in
 * `edgway.config.ts` (loaded with c12) and writes a module re-exporting each
 * one's default export (generated with knitwork), so the gateway bundles
 * exactly those plugins. Build-time only (Node).
 *
 * The gateway reads the module as a namespace:
 * `Object.values(await import("./plugins.gen"))` is the list of plugins.
 *
 * The plugins' own `messages` are merged into @edgway/i18n's catalog here
 * too (PRD "Plugins"): the module adds them with `addMessages` as it
 * loads, so it exports nothing but the plugins.
 */
import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { registryMessageId, t } from "@edgway/i18n";
import { loadConfig } from "c12";
import { genExport, genImport, genSafeVariableName } from "knitwork";

export interface EdgwayConfig {
  /** Plugin packages to bundle, e.g. "@edgway/plugin-cors". */
  plugins?: string[];
}

/** Typed helper for `edgway.config.ts`. */
export function defineEdgwayConfig(config: EdgwayConfig): EdgwayConfig {
  return config;
}

export interface GenerateRegistryOptions {
  /** Directory holding edgway.config.ts (or .json, .yaml: anything c12 loads). */
  cwd: string;
  /** Where to write the registry module. */
  outFile: string;
  /**
   * Loads a plugin package's default export, to read its messages. Defaults
   * to importing it as the registry module will, from `outFile`'s directory.
   */
  load?: (pkg: string) => Promise<unknown>;
}

/** Imports a package's default export, resolved from `from` (a file path). */
const importFrom = (from: string) => async (pkg: string) => {
  const resolved = createRequire(from).resolve(pkg);
  return ((await import(pathToFileURL(resolved).href)) as { default?: unknown })
    .default;
};

/**
 * The registry module's source for these packages (deduplicated, sorted),
 * and the plugins' messages (id → ICU message), when there are any.
 */
export function registrySource(
  packages: readonly string[],
  messages: Readonly<Record<string, string>> = {},
): string {
  const exports = [...new Set(packages)]
    .sort()
    .map((pkg) =>
      genExport(pkg, [{ name: "default", as: genSafeVariableName(pkg) }]),
    )
    .map((line) => `${line}\n`)
    .join("");
  const ids = Object.keys(messages).sort();
  if (ids.length === 0) return exports;
  const sorted = Object.fromEntries(ids.map((id) => [id, messages[id]]));
  const add = "addMessages";
  return [
    genImport("@edgway/i18n", [add]),
    exports,
    `${add}(${JSON.stringify(sorted, null, 2)});`,
    "",
  ].join("\n");
}

/** What codegen needs of a plugin: its name and messages. */
interface PluginMessages {
  name?: unknown;
  messages?: Record<string, { id?: string; defaultMessage?: unknown }>;
}

/**
 * The plugins' messages, by id. A plugin's ids must start with
 * `plugins.<its name>.`, so two plugins can't clash and none can take one
 * of Edgway's own ids.
 */
export function pluginMessages(
  plugins: readonly unknown[],
): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const plugin of plugins as PluginMessages[]) {
    const name = String(plugin?.name ?? "");
    const prefix = `plugins.${name}.`;
    for (const descriptor of Object.values(plugin?.messages ?? {})) {
      const id = descriptor?.id ?? "";
      if (!name || !id.startsWith(prefix)) {
        throw new Error(t(registryMessageId, { plugin: name, id, prefix }));
      }
      if (typeof descriptor.defaultMessage === "string") {
        merged[id] = descriptor.defaultMessage;
      }
    }
  }
  return merged;
}

export async function generateRegistry(
  options: GenerateRegistryOptions,
): Promise<string[]> {
  const { config } = await loadConfig<EdgwayConfig>({
    name: "edgway",
    cwd: options.cwd,
  });
  const packages = [...new Set(config.plugins ?? [])].sort();
  const load = options.load ?? importFrom(options.outFile);
  const messages = pluginMessages(await Promise.all(packages.map(load)));
  await writeFile(options.outFile, registrySource(packages, messages));
  return packages;
}
