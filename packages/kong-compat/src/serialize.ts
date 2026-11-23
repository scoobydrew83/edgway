/**
 * Kong's Admin API shapes: references as `{ id }` objects (or null), no
 * workspace, and credentials without hashes. Plugin configs are returned with
 * Kong's defaults filled in, as Kong stores them.
 */
import type { Row } from "@edgway/admin-core";
import { isPluginName, jsonSchema, kongSchema } from "@edgway/schema";

/** Our `<name>_id` column → Kong's `<name>` reference field. */
const REFERENCES = [
  "service",
  "route",
  "consumer",
  "consumer_group",
  "upstream",
  "certificate",
  "client_certificate",
] as const;

/** Fields never sent: the workspace and credential hashes. */
const HIDDEN = new Set(["workspace_id", "key_hash", "key_prefix", "password"]);

/**
 * Edgway-only key-auth fields (the portal's key names). Kong's
 * key-auth has none; a key-auth row is the one carrying a `key_prefix`.
 */
const KEY_AUTH_ONLY = new Set(["name"]);

/**
 * Edgway-only fields of other entities, which Kong's have no equivalent of
 * (a portal developer's `display_name` on consumers).
 */
export const EDGWAY_ONLY: ReadonlySet<string> = new Set(["display_name"]);

/**
 * A row's Edgway-only fields: the Kong mount never shows or sets them, and
 * keeps them as they are when Kong's PUT replaces the rest of the row.
 */
export function edgwayOnly(row: Row): Row {
  const keyAuth = "key_prefix" in row;
  return Object.fromEntries(
    Object.entries(row).filter(
      ([key]) => EDGWAY_ONLY.has(key) || (keyAuth && KEY_AUTH_ONLY.has(key)),
    ),
  );
}

export function kongRow(row: Row): Row {
  const out: Row = {};
  const only = edgwayOnly(row);
  for (const [key, value] of Object.entries(row)) {
    if (HIDDEN.has(key) || key in only) continue;
    const ref = REFERENCES.find((name) => key === `${name}_id`);
    if (ref) out[ref] = value ? { id: value } : null;
    else out[key] = value;
  }
  return out;
}

/** A plugin as Kong returns it: its config with Kong's defaults applied. */
export function kongPlugin(row: Row): Row {
  const plugin = kongRow(row);
  const name = String(plugin.name);
  if (!isPluginName(name)) return plugin;
  const parsed = kongSchema(name).safeParse({
    config: plugin.config ?? {},
    protocols: plugin.protocols ?? undefined,
  });
  if (!parsed.success) return plugin;
  const data = parsed.data as { config?: unknown; protocols?: unknown };
  // Kong stores every config field; unset ones are null.
  const fields = (
    jsonSchema(name) as {
      properties?: { config?: { properties?: Record<string, unknown> } };
    }
  ).properties?.config?.properties;
  const config = {
    ...Object.fromEntries(Object.keys(fields ?? {}).map((k) => [k, null])),
    ...((data.config ?? plugin.config) as Record<string, unknown>),
  };
  return {
    ...plugin,
    config,
    protocols: plugin.protocols ?? data.protocols ?? null,
  };
}
