/** zod schemas for every table, derived with drizzle-zod. */
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import * as tables from "./tables.js";

export type EntityName = keyof typeof tables;

export const ENTITY_NAMES = Object.keys(tables) as EntityName[];

const schemas = <T extends SQLiteTable>(table: T) => ({
  insert: createInsertSchema(table),
  select: createSelectSchema(table),
});

/** Insert and select zod schemas per table, keyed by Kong's table name. */
export const entitySchemas = {
  certificates: schemas(tables.certificates),
  ca_certificates: schemas(tables.ca_certificates),
  services: schemas(tables.services),
  routes: schemas(tables.routes),
  upstreams: schemas(tables.upstreams),
  targets: schemas(tables.targets),
  snis: schemas(tables.snis),
  vaults: schemas(tables.vaults),
  consumers: schemas(tables.consumers),
  consumer_groups: schemas(tables.consumer_groups),
  consumer_group_consumers: schemas(tables.consumer_group_consumers),
  plugins: schemas(tables.plugins),
  keyauth_credentials: schemas(tables.keyauth_credentials),
  basicauth_credentials: schemas(tables.basicauth_credentials),
  jwt_secrets: schemas(tables.jwt_secrets),
  acls: schemas(tables.acls),
  sandbox_plugins: schemas(tables.sandbox_plugins),
  audit_events: schemas(tables.audit_events),
  config_versions: schemas(tables.config_versions),
} satisfies Record<EntityName, unknown>;
