/**
 * The plugins an install's gateway bundles: the admin passes
 * its generated registry (the same `edgway.config.json` list as the
 * gateway's), so a third-party plugin is validated against its own
 * `definePlugin` schema and any other name is refused. Structural: admin-core
 * never imports a plugin.
 */
import { ERR, fail } from "@edgway/errors";
import { isPluginName, kongSchema, PLUGIN_NAMES } from "@edgway/schema";
import type { AuditContext } from "./audit.js";

/** A zod-like entity schema (`{ config, ... }`), as `definePlugin` keeps it. */
export interface PluginSchema {
  safeParse(input: unknown): {
    success: boolean;
    error?: {
      issues: readonly { path: readonly PropertyKey[]; message: string }[];
    };
  };
}

export interface CatalogPlugin {
  name: string;
  /** A Kong plugin Edgway vendors (Kong's defaults and schema endpoints apply). */
  kong: boolean;
  config: PluginSchema;
}

export type PluginCatalog = ReadonlyMap<string, CatalogPlugin>;

/** A catalog from plugins as `definePlugin` returns them (a registry's values). */
export function pluginCatalog(
  plugins: Iterable<{ name: string; config: PluginSchema }>,
): PluginCatalog {
  return new Map(
    [...plugins].map(({ name, config }) => [
      name,
      { name, kong: isPluginName(name), config },
    ]),
  );
}

/**
 * Every Kong plugin Edgway vendors, with its Kong schema: the default where
 * no registry is passed (the CLI's local import, the portal, tests).
 */
export const kongCatalog = (names: readonly string[] = PLUGIN_NAMES) =>
  pluginCatalog(
    names.filter(isPluginName).map((name) => ({
      name,
      config: kongSchema(name) as PluginSchema,
    })),
  );

let defaultCatalog: PluginCatalog | undefined;

/** What admin-core's services are given: who acts, and the bundled plugins. */
export interface CoreContext extends AuditContext {
  plugins?: PluginCatalog;
  /** The install's cap on portal developers; PORTAL.maxDevelopers when unset. */
  maxPortalDevelopers?: number;
}

export function catalogOf(ctx: CoreContext): PluginCatalog {
  if (ctx.plugins) return ctx.plugins;
  defaultCatalog ??= kongCatalog();
  return defaultCatalog;
}

/** 400 with the schema's issues unless the plugin accepts this config. */
export function checkPluginConfig(
  plugin: CatalogPlugin,
  config: unknown,
  extensions: Record<string, unknown> = {},
): void {
  const result = plugin.config.safeParse({ config: config ?? {} });
  if (result.success) return;
  fail(ERR.ADMIN_INVALID_REQUEST, {
    extensions: {
      ...extensions,
      name: plugin.name,
      issues: (result.error?.issues ?? []).map((i) => ({
        path: i.path.map(String).join("."),
        message: i.message,
      })),
    },
  });
}
