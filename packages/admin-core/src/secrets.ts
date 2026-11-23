/**
 * Secret values the admin never shows. A vault reference isn't a
 * secret and stays visible; anything else becomes a placeholder.
 * - Entity columns: `SECRETS.entityFields` (jwt secrets, certificate keys),
 *   and the hash columns in `SECRETS.hashFields`, always masked.
 * - A plugin's config: the fields Kong's own schema for that plugin marks
 *   encrypted (`SECRETS.kongEncryptedMarker`), by path. A config with no
 *   Kong schema (an uploaded plugin's, a vault's) falls back to the field
 *   names in `SECRETS.configFields`, at any depth.
 */
import { isVaultReference } from "@edgway/adapters-cf/secrets";
import { ADMIN_DIFF, SECRETS, VAULTS } from "@edgway/constants";
import { isPluginName, jsonSchema } from "@edgway/schema";

// The one home of the check; re-exported for kong-compat.
export { isVaultReference };

/** An entity row (as entities.ts's `Row`; declared here to avoid an import cycle). */
type Row = Record<string, unknown>;

const CONFIG_FIELDS = new Set(SECRETS.configFields);

/** The placeholder for `value`, marked changed when it differs from `before`. */
const placeholder = (value: unknown, before: unknown) =>
  before !== undefined && before !== value
    ? ADMIN_DIFF.redactedChanged
    : ADMIN_DIFF.redacted;

/** A secret value's placeholder; empty values and references are kept. */
const maskValue = (value: unknown, before: unknown): unknown =>
  Array.isArray(value)
    ? value.map((v, i) =>
        maskValue(v, Array.isArray(before) ? before[i] : undefined),
      )
    : value === null || value === undefined || isVaultReference(value)
      ? value
      : value !== null && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value).map(([k, v]) => [
              k,
              maskValue(v, (before as Record<string, unknown>)?.[k]),
            ]),
          )
        : placeholder(value, before);

/** Mask the fields named in `SECRETS.configFields`, at any depth. */
function redactByName(value: unknown, before?: unknown): unknown {
  if (Array.isArray(value)) {
    const prior = Array.isArray(before) ? before : [];
    return value.map((v, i) => redactByName(v, prior[i]));
  }
  if (!value || typeof value !== "object") return value;
  const prior = (before && typeof before === "object" ? before : {}) as Record<
    string,
    unknown
  >;
  return Object.fromEntries(
    Object.entries(value).map(([key, v]) => [
      key,
      CONFIG_FIELDS.has(key)
        ? maskValue(v, prior[key])
        : redactByName(v, prior[key]),
    ]),
  );
}

/** A path into a config: property names, `ITEMS` for every array item. */
type Path = readonly string[];
const ITEMS = VAULTS.anyItem;

/** The paths of a JSON Schema's fields whose description carries `marker`. */
function markedPaths(schema: unknown, marker: string, path: Path = []): Path[] {
  if (!schema || typeof schema !== "object") return [];
  const node = schema as Record<string, unknown>;
  const own =
    typeof node.description === "string" && node.description.includes(marker)
      ? [path]
      : [];
  const nested = [
    ...Object.entries(
      (node.properties ?? {}) as Record<string, unknown>,
    ).flatMap(([key, child]) => markedPaths(child, marker, [...path, key])),
    ...(node.items ? markedPaths(node.items, marker, [...path, ITEMS]) : []),
    ...(["anyOf", "oneOf", "allOf"] as const).flatMap((k) =>
      Array.isArray(node[k])
        ? (node[k] as unknown[]).flatMap((s) => markedPaths(s, marker, path))
        : [],
    ),
  ];
  return [...own, ...nested];
}

/** A plugin's config paths carrying a marker (from its Kong schema), computed once. */
function configPaths(cache: Map<string, Path[]>, marker: string) {
  return (name: string): Path[] | undefined => {
    if (!isPluginName(name)) return undefined;
    let paths = cache.get(name);
    if (!paths) {
      // The schema describes the plugin entity: its config is under `config`.
      paths = markedPaths(jsonSchema(name), marker)
        .filter((p) => p[0] === "config")
        .map((p) => p.slice(1));
      cache.set(name, paths);
    }
    return paths;
  };
}

/** A plugin's encrypted config paths (from its Kong schema). */
export const pluginSecretPaths = configPaths(
  new Map(),
  SECRETS.kongEncryptedMarker,
);

/** A plugin's config paths that may hold a vault reference. */
const pluginReferenceablePaths = configPaths(
  new Map(),
  SECRETS.kongReferenceableMarker,
);

/** Every path in a value that holds a vault reference (array items as `ITEMS`). */
function referencePaths(value: unknown, path: Path = []): Path[] {
  if (isVaultReference(value)) return [path];
  if (Array.isArray(value)) {
    return value.flatMap((v) => referencePaths(v, [...path, ITEMS]));
  }
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) =>
      referencePaths(v, [...path, k]),
    );
  }
  return [];
}

/** Whether a found path lies in one of the allowed (marked) paths. */
const within = (allowed: Path[], found: Path) =>
  allowed.some(
    (prefix) =>
      prefix.length <= found.length &&
      prefix.every((key, i) => key === found[i]),
  );

/**
 * The config fields holding a vault reference where the plugin's Kong schema
 * doesn't allow one: a reference resolves only in a field Kong marks
 * referenceable, so it can't be used to send a secret to a client or a log
 * endpoint. A plugin without a Kong schema (an uploaded one) allows none.
 */
export function misplacedVaultReferences(
  name: string,
  config: unknown,
): string[] {
  const allowed = pluginReferenceablePaths(name) ?? [];
  return referencePaths(config)
    .filter((found) => !within(allowed, found))
    .map((found) => found.join("."));
}

/**
 * The paths of a plugin config's vault references in referenceable fields:
 * published with the plugin as `vault_paths`, the only places the gateway
 * resolves a reference.
 */
export function allowedVaultPaths(name: string, config: unknown): string[][] {
  const allowed = pluginReferenceablePaths(name) ?? [];
  return referencePaths(config)
    .filter((found) => within(allowed, found))
    .map((found) => [...found]);
}

/** Every path to a non-empty string in a value (array items as `ITEMS`). */
function stringPaths(value: unknown, path: Path = []): [Path, string][] {
  if (typeof value === "string") return value ? [[path, value]] : [];
  if (Array.isArray(value)) {
    return value.flatMap((v) => stringPaths(v, [...path, ITEMS]));
  }
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) =>
      stringPaths(v, [...path, k]),
    );
  }
  return [];
}

/**
 * The config fields holding a secret as plain text where a vault reference
 * would do: fields Kong's schema marks both encrypted and
 * referenceable. Edgway accepts the value, and the publish warns: the
 * secret then lives in D1, rather than in a Worker secret or Secrets Store.
 */
export function rawSecretFields(name: string, config: unknown): string[] {
  const secret = pluginSecretPaths(name) ?? [];
  const referenceable = pluginReferenceablePaths(name) ?? [];
  return stringPaths(config)
    .filter(
      ([found, value]) =>
        within(secret, found) &&
        within(referenceable, found) &&
        !isVaultReference(value),
    )
    .map(([found]) => found.join("."));
}

/** Mask the value at `path` (and below it). */
function maskPath(value: unknown, path: Path, before: unknown): unknown {
  const [head, ...rest] = path;
  if (head === undefined) return maskValue(value, before);
  if (head === ITEMS) {
    if (!Array.isArray(value)) return value;
    return value.map((v, i) =>
      maskPath(v, rest, Array.isArray(before) ? before[i] : undefined),
    );
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const record = value as Record<string, unknown>;
  if (!(head in record)) return value;
  return {
    ...record,
    [head]: maskPath(
      record[head],
      rest,
      (before as Record<string, unknown> | undefined)?.[head],
    ),
  };
}

/** A config with its secrets masked: by its plugin's Kong schema, or by field name. */
function redactConfig(plugin: unknown, config: unknown, before: unknown) {
  const paths =
    typeof plugin === "string" ? pluginSecretPaths(plugin) : undefined;
  if (!paths) return redactByName(config, before);
  return paths.reduce<unknown>(
    (masked, path) => maskPath(masked, path, before),
    config,
  );
}

/**
 * A copy of an entity row with its secrets masked. With `before` (the same
 * row's earlier version), a changed secret gets its own placeholder, so a
 * rotation still shows in a diff.
 */
export function redactRow(table: string, row: Row, before?: Row): Row {
  const copy: Row = { ...row };
  for (const field of SECRETS.hashFields[table] ?? []) {
    if (field in copy) copy[field] = placeholder(row[field], before?.[field]);
  }
  for (const field of SECRETS.entityFields[table] ?? []) {
    const value = copy[field];
    if (value !== null && value !== undefined && !isVaultReference(value)) {
      copy[field] = placeholder(value, before?.[field]);
    }
  }
  if ("config" in copy) {
    copy.config = redactConfig(
      table === "plugins" ? copy.name : undefined,
      copy.config,
      before?.config,
    );
  }
  return copy;
}
