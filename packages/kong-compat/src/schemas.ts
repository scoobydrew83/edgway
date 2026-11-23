/**
 * `/schemas/{entity}` and `/schemas/plugins/{name}` in Kong's own format (a
 * `fields` list of `{ name: { type, default, ... } }`), which decK reads to
 * fill defaults before diffing. Plugin schemas come from Kong's vendored JSON
 * Schemas; entity schemas from the D1 tables' column defaults, which carry
 * Kong's defaults.
 */
import {
  type EntityName,
  isPluginName,
  jsonSchema,
  tables,
} from "@edgway/schema";
import { getTableColumns, SQL } from "drizzle-orm";
import { EDGWAY_ONLY } from "./serialize.js";

type KongField = Record<string, unknown>;
type JsonSchema = {
  type?: string | string[];
  default?: unknown;
  enum?: unknown[];
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  required?: string[];
};

/** One JSON Schema property as a Kong field definition. */
function kongField(schema: JsonSchema, required: boolean): KongField {
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  const field: KongField = {};
  if (type === "object" && schema.properties) {
    field.type = "record";
    field.fields = kongFields(schema);
  } else if (type === "object") {
    field.type = "map";
  } else if (type === "array") {
    field.type = "array";
    if (schema.items) field.elements = kongField(schema.items, false);
  } else {
    field.type = type ?? "string";
  }
  if (schema.default !== undefined) field.default = schema.default;
  if (schema.enum) field.one_of = schema.enum;
  if (required) field.required = true;
  return field;
}

function kongFields(schema: JsonSchema): KongField[] {
  const required = new Set(schema.required ?? []);
  return Object.entries(schema.properties ?? {}).map(([name, property]) => ({
    [name]: kongField(property, required.has(name)),
  }));
}

/** A plugin's Kong schema, or undefined when Edgway doesn't know the plugin. */
export function pluginSchema(name: string) {
  if (!isPluginName(name)) return undefined;
  return { fields: kongFields(jsonSchema(name) as JsonSchema) };
}

/** Kong's entity names (URL segments) → our tables. */
export const ENTITY_TABLES: Record<string, EntityName> = {
  services: "services",
  routes: "routes",
  upstreams: "upstreams",
  targets: "targets",
  consumers: "consumers",
  consumer_groups: "consumer_groups",
  certificates: "certificates",
  ca_certificates: "ca_certificates",
  snis: "snis",
  vaults: "vaults",
  plugins: "plugins",
};

const KONG_TYPES: Record<string, string> = {
  string: "string",
  number: "integer",
  boolean: "boolean",
  json: "array",
};

/**
 * Kong's types for the JSON columns that aren't plain arrays: its
 * typedefs make these sets, maps and records. Any other JSON column is an
 * array.
 */
const JSON_FIELD_TYPES: Record<string, string> = {
  tags: "set",
  protocols: "set",
  methods: "set",
  snis: "set",
  sources: "set",
  destinations: "set",
  headers: "map",
  config: "record",
  healthchecks: "record",
  ordering: "record",
};

/**
 * An entity's Kong schema from its table: every column, with the column's
 * default where it has a plain value (SQL defaults are timestamps and ids).
 */
export function entitySchema(entity: string) {
  const name = ENTITY_TABLES[entity];
  if (!name) return undefined;
  const fields = Object.entries(getTableColumns(tables[name]))
    .filter(([key]) => key !== "workspace_id" && !EDGWAY_ONLY.has(key))
    .map(([key, column]) => {
      const field: KongField = {
        type:
          column.dataType === "json"
            ? (JSON_FIELD_TYPES[key] ?? KONG_TYPES.json)
            : (KONG_TYPES[column.dataType] ?? "string"),
      };
      if (column.default !== undefined && !(column.default instanceof SQL)) {
        field.default = column.default;
      }
      if (column.notNull && !column.hasDefault) field.required = true;
      return { [key.replace(/_id$/, "")]: field };
    });
  return { fields };
}

/** Schemas decK asks for that Edgway has no entity for: an empty schema. */
export const EMPTY_SCHEMAS = new Set(["consumer_group_plugins"]);
