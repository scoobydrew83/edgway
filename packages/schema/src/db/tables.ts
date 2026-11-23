/**
 * D1 tables for Kong's entities, with Kong's field names and defaults (Kong
 * 3.9 entity definitions; fields cross-checked against the vendored decK file
 * schema). Foreign keys use Kong's own column names (`service_id`, ...), as in
 * Kong's database; the Admin API's nested `{ id }` shape is kong-compat's job.
 * Every table carries `workspace_id` (PRD decision 7).
 */
import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  unique,
} from "drizzle-orm/sqlite-core";
import {
  bool,
  createdAt,
  id,
  json,
  tags,
  updatedAt,
  workspaceId,
} from "./columns.js";

// Gateway entities

export const certificates = sqliteTable("certificates", {
  id: id(),
  workspace_id: workspaceId(),
  cert: text().notNull(),
  /** A `{vault://...}` reference; private keys are not stored in D1. */
  key: text().notNull(),
  cert_alt: text(),
  key_alt: text(),
  tags: tags(),
  created_at: createdAt(),
  updated_at: updatedAt(),
});

export const ca_certificates = sqliteTable(
  "ca_certificates",
  {
    id: id(),
    workspace_id: workspaceId(),
    cert: text().notNull(),
    cert_digest: text(),
    tags: tags(),
    created_at: createdAt(),
    updated_at: updatedAt(),
  },
  (t) => [unique().on(t.workspace_id, t.cert_digest)],
);

export const services = sqliteTable(
  "services",
  {
    id: id(),
    workspace_id: workspaceId(),
    name: text(),
    protocol: text().notNull().default("http"),
    host: text().notNull(),
    port: integer().notNull().default(80),
    path: text(),
    retries: integer().notNull().default(5),
    connect_timeout: integer().notNull().default(60000),
    write_timeout: integer().notNull().default(60000),
    read_timeout: integer().notNull().default(60000),
    client_certificate_id: text().references(() => certificates.id),
    tls_verify: bool(),
    tls_verify_depth: integer(),
    ca_certificates: json<string[]>(),
    enabled: bool().notNull().default(true),
    tags: tags(),
    created_at: createdAt(),
    updated_at: updatedAt(),
  },
  (t) => [unique().on(t.workspace_id, t.name)],
);

export const routes = sqliteTable(
  "routes",
  {
    id: id(),
    workspace_id: workspaceId(),
    name: text(),
    service_id: text().references(() => services.id),
    protocols: json<string[]>().notNull().default(["http", "https"]),
    methods: json<string[]>(),
    hosts: json<string[]>(),
    paths: json<string[]>(),
    headers: json<Record<string, string[]>>(),
    https_redirect_status_code: integer().notNull().default(426),
    regex_priority: integer().notNull().default(0),
    strip_path: bool().notNull().default(true),
    path_handling: text().notNull().default("v0"),
    preserve_host: bool().notNull().default(false),
    request_buffering: bool().notNull().default(true),
    response_buffering: bool().notNull().default(true),
    snis: json<string[]>(),
    sources: json<{ ip?: string; port?: number }[]>(),
    destinations: json<{ ip?: string; port?: number }[]>(),
    expression: text(),
    priority: integer(),
    tags: tags(),
    created_at: createdAt(),
    updated_at: updatedAt(),
  },
  (t) => [
    unique().on(t.workspace_id, t.name),
    index("routes_service_id_idx").on(t.service_id),
  ],
);

export const upstreams = sqliteTable(
  "upstreams",
  {
    id: id(),
    workspace_id: workspaceId(),
    name: text().notNull(),
    algorithm: text().notNull().default("round-robin"),
    hash_on: text().notNull().default("none"),
    hash_fallback: text().notNull().default("none"),
    hash_on_header: text(),
    hash_fallback_header: text(),
    hash_on_cookie: text(),
    hash_on_cookie_path: text().notNull().default("/"),
    hash_on_query_arg: text(),
    hash_fallback_query_arg: text(),
    hash_on_uri_capture: text(),
    hash_fallback_uri_capture: text(),
    slots: integer().notNull().default(10000),
    healthchecks: json<Record<string, unknown>>(),
    host_header: text(),
    client_certificate_id: text().references(() => certificates.id),
    use_srv_name: bool().notNull().default(false),
    sticky_sessions_cookie: text(),
    sticky_sessions_cookie_path: text().notNull().default("/"),
    tags: tags(),
    created_at: createdAt(),
    updated_at: updatedAt(),
  },
  (t) => [unique().on(t.workspace_id, t.name)],
);

export const targets = sqliteTable(
  "targets",
  {
    id: id(),
    workspace_id: workspaceId(),
    upstream_id: text()
      .notNull()
      .references(() => upstreams.id, { onDelete: "cascade" }),
    target: text().notNull(),
    weight: integer().notNull().default(100),
    failover: bool().notNull().default(false),
    tags: tags(),
    // Kong reports target timestamps with millisecond precision.
    created_at: real().notNull().default(sql`(unixepoch('subsec'))`),
    updated_at: real()
      .notNull()
      .default(sql`(unixepoch('subsec'))`)
      .$onUpdateFn(() => Date.now() / 1000),
  },
  (t) => [unique().on(t.upstream_id, t.target)],
);

export const snis = sqliteTable(
  "snis",
  {
    id: id(),
    workspace_id: workspaceId(),
    name: text().notNull(),
    certificate_id: text()
      .notNull()
      .references(() => certificates.id, { onDelete: "cascade" }),
    tags: tags(),
    created_at: createdAt(),
    updated_at: updatedAt(),
  },
  (t) => [unique().on(t.workspace_id, t.name)],
);

export const vaults = sqliteTable(
  "vaults",
  {
    id: id(),
    workspace_id: workspaceId(),
    name: text().notNull(),
    prefix: text().notNull(),
    description: text(),
    config: json<Record<string, unknown>>(),
    tags: tags(),
    created_at: createdAt(),
    updated_at: updatedAt(),
  },
  (t) => [unique().on(t.workspace_id, t.prefix)],
);

// Consumers

export const consumers = sqliteTable(
  "consumers",
  {
    id: id(),
    workspace_id: workspaceId(),
    username: text(),
    custom_id: text(),
    /**
     * Edgway-only: the developer portal's OIDC subject. Set only by
     * the portal, so a developer can never claim a consumer an admin made.
     */
    portal_subject: text(),
    /**
     * Set by an admin to revoke a portal developer: the portal
     * refuses the subject, which keeps its consumer so it can't sign up again.
     */
    portal_blocked: bool().notNull().default(false),
    /**
     * Edgway-only: a portal developer's label from the IdP, shown
     * to admins. Never the Kong `username`, which decK, Terraform and
     * plugins match on, so a developer can't claim a name an operator uses.
     */
    display_name: text(),
    tags: tags(),
    created_at: createdAt(),
    updated_at: updatedAt(),
  },
  (t) => [
    unique().on(t.workspace_id, t.username),
    unique().on(t.workspace_id, t.custom_id),
    unique().on(t.workspace_id, t.portal_subject),
  ],
);

export const consumer_groups = sqliteTable(
  "consumer_groups",
  {
    id: id(),
    workspace_id: workspaceId(),
    name: text().notNull(),
    tags: tags(),
    created_at: createdAt(),
    updated_at: updatedAt(),
  },
  (t) => [unique().on(t.workspace_id, t.name)],
);

/** Consumer-group membership (Kong's `consumer_group_consumers`). */
export const consumer_group_consumers = sqliteTable(
  "consumer_group_consumers",
  {
    workspace_id: workspaceId(),
    consumer_group_id: text()
      .notNull()
      .references(() => consumer_groups.id, { onDelete: "cascade" }),
    consumer_id: text()
      .notNull()
      .references(() => consumers.id, { onDelete: "cascade" }),
    created_at: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.consumer_group_id, t.consumer_id] })],
);

export const plugins = sqliteTable(
  "plugins",
  {
    id: id(),
    workspace_id: workspaceId(),
    name: text().notNull(),
    instance_name: text(),
    route_id: text().references(() => routes.id, { onDelete: "cascade" }),
    service_id: text().references(() => services.id, { onDelete: "cascade" }),
    consumer_id: text().references(() => consumers.id, {
      onDelete: "cascade",
    }),
    consumer_group_id: text().references(() => consumer_groups.id, {
      onDelete: "cascade",
    }),
    config: json<Record<string, unknown>>().notNull().default({}),
    enabled: bool().notNull().default(true),
    /** What the gateway does when this instance breaks; null: the plugin's default. */
    on_error: text({ enum: ["fail-open", "fail-closed"] }),
    protocols: json<string[]>(),
    ordering: json<Record<string, unknown>>(),
    tags: tags(),
    created_at: createdAt(),
    updated_at: updatedAt(),
  },
  (t) => [unique().on(t.workspace_id, t.instance_name)],
);

// Credentials (Kong's table names)

/** key-auth: the key is stored as a SHA-256 hash plus a display prefix (PRD). */
export const keyauth_credentials = sqliteTable(
  "keyauth_credentials",
  {
    id: id(),
    workspace_id: workspaceId(),
    consumer_id: text()
      .notNull()
      .references(() => consumers.id, { onDelete: "cascade" }),
    key_hash: text().notNull(),
    key_prefix: text().notNull(),
    /** A label the developer portal gives the key; not Kong's. */
    name: text(),
    ttl: integer(),
    tags: tags(),
    created_at: createdAt(),
  },
  (t) => [unique().on(t.workspace_id, t.key_hash)],
);

/** basic-auth: `password` holds a hash, as in Kong. */
export const basicauth_credentials = sqliteTable(
  "basicauth_credentials",
  {
    id: id(),
    workspace_id: workspaceId(),
    consumer_id: text()
      .notNull()
      .references(() => consumers.id, { onDelete: "cascade" }),
    username: text().notNull(),
    password: text().notNull(),
    tags: tags(),
    created_at: createdAt(),
  },
  (t) => [unique().on(t.workspace_id, t.username)],
);

export const jwt_secrets = sqliteTable(
  "jwt_secrets",
  {
    id: id(),
    workspace_id: workspaceId(),
    consumer_id: text()
      .notNull()
      .references(() => consumers.id, { onDelete: "cascade" }),
    key: text().notNull(),
    /** A `{vault://...}` reference for HMAC secrets; not stored in D1. */
    secret: text(),
    rsa_public_key: text(),
    algorithm: text().notNull().default("HS256"),
    tags: tags(),
    created_at: createdAt(),
  },
  (t) => [unique().on(t.workspace_id, t.key)],
);

export const acls = sqliteTable(
  "acls",
  {
    id: id(),
    workspace_id: workspaceId(),
    consumer_id: text()
      .notNull()
      .references(() => consumers.id, { onDelete: "cascade" }),
    group: text().notNull(),
    tags: tags(),
    created_at: createdAt(),
  },
  (t) => [unique().on(t.consumer_id, t.group)],
);

// Edgway-only entities

/**
 * A third-party plugin run in a Dynamic Worker sandbox: its
 * ES module source, limits and the bindings it may use. Published with the
 * snapshot; instances are `plugins` rows naming it.
 */
export const sandbox_plugins = sqliteTable(
  "sandbox_plugins",
  {
    id: id(),
    workspace_id: workspaceId(),
    name: text().notNull(),
    version: text().notNull().default("0.0.0"),
    priority: integer().notNull().default(0),
    code: text().notNull(),
    cpu_ms: integer(),
    sub_requests: integer(),
    bindings: json<string[]>(),
    tags: tags(),
    created_at: createdAt(),
    updated_at: updatedAt(),
  },
  (t) => [unique().on(t.workspace_id, t.name)],
);

export const audit_events = sqliteTable(
  "audit_events",
  {
    id: id(),
    workspace_id: workspaceId(),
    actor: text().notNull(),
    action: text().notNull(),
    entity_type: text().notNull(),
    entity_id: text(),
    request_id: text(),
    diff: json<unknown[]>(),
    created_at: createdAt(),
  },
  (t) => [
    index("audit_events_workspace_created_idx").on(
      t.workspace_id,
      t.created_at,
    ),
  ],
);

/** Published snapshots; the snapshot itself lives in KV at `config:v{version}`. */
export const config_versions = sqliteTable(
  "config_versions",
  {
    id: id(),
    workspace_id: workspaceId(),
    version: integer().notNull(),
    sha256: text().notNull(),
    diff: json<unknown[]>(),
    created_by: text().notNull(),
    note: text(),
    created_at: createdAt(),
  },
  (t) => [unique().on(t.workspace_id, t.version)],
);
