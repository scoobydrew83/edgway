/**
 * The plugins this install's gateway bundles: the admin is
 * generated from the same root edgway.config.json as the gateway, so it
 * accepts exactly those plugins and validates each config against the
 * plugin's own `definePlugin` schema (Kong's, or a third-party plugin's).
 */
import { pluginCatalog } from "@edgway/admin-core";
import { isPluginName, jsonSchema } from "@edgway/schema";
import { z } from "zod";
import * as registry from "./generated/plugins";

const bundled = new Map(
  Object.values(registry).map((plugin) => [plugin.name, plugin]),
);

export const PLUGINS = pluginCatalog(bundled.values());

/** A bundled plugin's JSON Schema: Kong's, or one derived from its zod schema. */
export function pluginJsonSchema(name: string): unknown {
  const plugin = bundled.get(name);
  if (!plugin) return undefined;
  return isPluginName(name)
    ? jsonSchema(name)
    : z.toJSONSchema(plugin.config, { unrepresentable: "any" });
}

/** A bundled plugin's Kong priority (which-plugins). */
export const pluginPriority = (name: string): number | undefined =>
  bundled.get(name)?.priority;
