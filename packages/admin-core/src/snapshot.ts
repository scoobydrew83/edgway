/**
 * Staging: D1 holds the staged configuration and KV holds what is published.
 * `compileSnapshot` builds the data plane's snapshot from the workspace's
 * rows; `pendingDiff` compares it with the published one (microdiff), keyed
 * by entity id so one insert doesn't shift every later row.
 */
import type { Snapshot } from "@edgway/adapters-cf";
import { type EntityName, tables } from "@edgway/schema";
import { asc, eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import diff, { type Difference } from "microdiff";
import type { AuditContext } from "./audit.js";
import { type Row, table } from "./entities.js";
import { allowedVaultPaths, redactRow } from "./secrets.js";

const nullToUndefined = (row: Row): Row =>
  Object.fromEntries(Object.entries(row).filter(([, v]) => v !== null));

const pick = (row: Row, fields: readonly string[]) =>
  nullToUndefined(Object.fromEntries(fields.map((f) => [f, row[f]])));

async function rowsOf(
  db: DrizzleD1Database,
  ctx: AuditContext,
  name: EntityName,
): Promise<Row[]> {
  const t = table(name);
  const order =
    name === "consumer_group_consumers"
      ? tables.consumer_group_consumers.consumer_id
      : t.id;
  return (await db
    .select()
    .from(t)
    .where(eq(t.workspace_id, ctx.workspaceId))
    .orderBy(asc(order))) as Row[];
}

const SERVICE_FIELDS = [
  "id",
  "name",
  "protocol",
  "host",
  "port",
  "path",
  "retries",
  "connect_timeout",
  "read_timeout",
  // Tags select a Service Binding or Workers VPC target.
  "tags",
] as const;

const UPSTREAM_FIELDS = [
  "id",
  "name",
  "algorithm",
  "hash_on",
  "hash_fallback",
  "hash_on_header",
  "hash_fallback_header",
  "hash_on_cookie",
  "hash_on_query_arg",
  "hash_fallback_query_arg",
  "healthchecks",
] as const;

const ROUTE_FIELDS = [
  "id",
  "service_id",
  "methods",
  "hosts",
  "paths",
  "headers",
  "snis",
  "sources",
  "destinations",
  "expression",
  "strip_path",
  "preserve_host",
  "regex_priority",
  "path_handling",
  // https-only routes answer 426 to plain HTTP.
  "protocols",
  // ...or redirect it to HTTPS.
  "https_redirect_status_code",
] as const;

const PLUGIN_FIELDS = [
  "id",
  "name",
  "route_id",
  "service_id",
  "consumer_id",
  "consumer_group_id",
  "enabled",
  "on_error",
  "config",
] as const;

/** The data plane's snapshot of a workspace's staged configuration. */
export async function compileSnapshot(
  db: DrizzleD1Database,
  ctx: AuditContext,
): Promise<Snapshot> {
  const [
    services,
    routes,
    plugins,
    consumers,
    keys,
    jwts,
    basics,
    acls,
    groups,
    members,
    sandboxed,
    upstreams,
    targets,
  ] = await Promise.all(
    (
      [
        "services",
        "routes",
        "plugins",
        "consumers",
        "keyauth_credentials",
        "jwt_secrets",
        "basicauth_credentials",
        "acls",
        "consumer_groups",
        "consumer_group_consumers",
        "sandbox_plugins",
        "upstreams",
        "targets",
      ] as const
    ).map((name) => rowsOf(db, ctx, name)),
  );
  // As in Kong, a disabled service and its routes aren't loaded (routes 404).
  const disabled = new Set(
    (services ?? []).filter((s) => s.enabled === false).map((s) => s.id),
  );
  return {
    services: (services ?? [])
      .filter((s) => !disabled.has(s.id))
      .map((s) => pick(s, SERVICE_FIELDS)) as unknown as Snapshot["services"],
    routes: (routes ?? [])
      .filter((r) => !disabled.has(r.service_id))
      .map((r) => pick(r, ROUTE_FIELDS)) as unknown as Snapshot["routes"],
    plugins: (plugins ?? []).map((p) => {
      const row = pick(p, PLUGIN_FIELDS);
      // Where the gateway may resolve a vault reference.
      const vault = allowedVaultPaths(String(p.name), p.config);
      return vault.length > 0 ? { ...row, vault_paths: vault } : row;
    }) as unknown as Snapshot["plugins"],
    consumers: (consumers ?? []).map((c) =>
      pick(c, ["id", "username", "custom_id"]),
    ) as unknown as Snapshot["consumers"],
    keyauth_credentials: (keys ?? []).map((k) => ({
      id: String(k.id),
      consumer_id: String(k.consumer_id),
      key_hash: String(k.key_hash),
      // Kong's ttl counts from creation.
      expires_at: k.ttl ? Number(k.created_at) + Number(k.ttl) : null,
    })),
    jwt_secrets: (jwts ?? []).map((j) =>
      pick(j, [
        "id",
        "consumer_id",
        "key",
        "algorithm",
        "secret",
        "rsa_public_key",
      ]),
    ) as unknown as Snapshot["jwt_secrets"],
    basicauth_credentials: (basics ?? []).map((b) =>
      pick(b, ["id", "consumer_id", "username", "password"]),
    ) as unknown as Snapshot["basicauth_credentials"],
    acls: (acls ?? []).map((a) => ({
      consumer_id: String(a.consumer_id),
      group: String(a.group),
    })),
    consumer_groups: (groups ?? []).map((g) => ({
      id: String(g.id),
      name: String(g.name),
    })),
    consumer_group_consumers: (members ?? []).map((m) => ({
      consumer_group_id: String(m.consumer_group_id),
      consumer_id: String(m.consumer_id),
    })),
    sandbox_plugins: (sandboxed ?? []).map((p) =>
      pick(p, [
        "id",
        "name",
        "version",
        "priority",
        "code",
        "cpu_ms",
        "sub_requests",
        "bindings",
      ]),
    ) as unknown as Snapshot["sandbox_plugins"],
    // Kong upstreams and their targets: a service whose host names an
    // upstream is balanced over its targets.
    upstreams: (upstreams ?? []).map((u) =>
      pick(u, UPSTREAM_FIELDS),
    ) as unknown as Snapshot["upstreams"],
    targets: (targets ?? []).map((t) => ({
      id: String(t.id),
      upstream_id: String(t.upstream_id),
      target: String(t.target),
      weight: Number(t.weight),
    })),
  };
}

/** An empty snapshot: the base of the first publish's diff. */
export const EMPTY_SNAPSHOT: Snapshot = {
  services: [],
  routes: [],
  plugins: [],
  consumers: [],
};

/** Each table as an object keyed by row identity, for a stable diff. */
function keyed(snapshot: Snapshot): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const [name, rows] of Object.entries(snapshot)) {
    out[name] = Object.fromEntries(
      (rows as Row[]).map((row) => [
        String(
          row.id ??
            [row.consumer_id, row.group ?? row.consumer_group_id].join(":"),
        ),
        row,
      ]),
    );
  }
  return out;
}

/**
 * Replace secrets with placeholders (secrets.ts). A staged secret that
 * differs from the published one gets its own placeholder, so a rotation
 * still shows as a change.
 */
function redact(
  published: Record<string, Record<string, unknown>>,
  staged: Record<string, Record<string, unknown>>,
) {
  const mask = (
    rows: Record<string, unknown>,
    other?: Record<string, unknown>,
  ) => {
    for (const [name, table] of Object.entries(rows)) {
      for (const [key, row] of Object.entries(
        (table ?? {}) as Record<string, Row>,
      )) {
        const before = (other?.[name] as Record<string, Row> | undefined)?.[
          key
        ];
        (table as Record<string, Row>)[key] = redactRow(name, row, before);
      }
    }
  };
  // Staged first: it compares against the published secrets, still intact.
  mask(staged, published);
  mask(published);
}

/** What publishing now would change, relative to `published`. Secrets are masked. */
export function snapshotDiff(
  published: Snapshot | undefined,
  staged: Snapshot,
): Difference[] {
  const before = keyed(published ?? EMPTY_SNAPSHOT);
  const after = keyed(staged);
  redact(before, after);
  return diff(before, after);
}
