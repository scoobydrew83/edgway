/**
 * Audit events: one row per change, written in the same D1 batch as the
 * change itself, with the field-level diff (microdiff) of the entity.
 */
import { AUDIT_PAGE } from "@edgway/constants";
import { tables } from "@edgway/schema";
import { and, desc, eq, inArray, lt } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import diff from "microdiff";
import { uuidv7 } from "uuidv7";
import { redactRow } from "./secrets.js";

/** Who is changing what, in which workspace. */
export interface AuditContext {
  workspaceId: string;
  /** The admin identity (an Access email or service-token id). */
  actor: string;
  requestId?: string;
}

/** What an audit event records. */
export const AUDIT_ACTIONS = [
  "create",
  "update",
  "delete",
  "publish",
  "rollback",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** The insert statement for one audit event (batched with the change). */
export function auditInsert(
  db: DrizzleD1Database,
  ctx: AuditContext,
  action: AuditAction,
  entityType: string,
  entityId: string | undefined,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
) {
  return db.insert(tables.audit_events).values({
    id: uuidv7(),
    workspace_id: ctx.workspaceId,
    actor: ctx.actor,
    action,
    entity_type: entityType,
    entity_id: entityId,
    request_id: ctx.requestId,
    diff: diff(
      // Secrets masked; a changed one shows as changed (secrets.ts).
      redactRow(entityType, before),
      redactRow(entityType, after, before),
    ),
  });
}

/** D1 binds at most 100 parameters per query: ids are looked up in chunks. */
const CHUNK = 90;

/**
 * The columns an entity is named by, in order (Kong's own names). A JWT
 * credential is named by its `key` (the iss); a certificate's `key` is its
 * private key's reference, never a name.
 */
const LABELS = ["name", "username", "display_name", "target", "group"];
const labelsOf = (type: unknown) =>
  type === "jwt_secrets" ? [...LABELS, "key"] : LABELS;

/** The fields a plugin is scoped by, and the entity each names. */
const SCOPES = {
  route_id: "routes",
  service_id: "services",
  consumer_id: "consumers",
  consumer_group_id: "consumer_groups",
} as const;

/** A consumer's credentials are named by their consumer ("API key on consumer …"). */
const CREDENTIALS = new Set([
  "keyauth_credentials",
  "basicauth_credentials",
  "jwt_secrets",
  "acls",
]);

/** The scope fields an event's entity is named with, if any. */
const scopeFields = (type: unknown): (keyof typeof SCOPES)[] =>
  type === "plugins"
    ? (Object.keys(SCOPES) as (keyof typeof SCOPES)[])
    : CREDENTIALS.has(String(type))
      ? ["consumer_id"]
      : [];

type Row = Record<string, unknown>;
type Table = Record<string, SQLiteColumn>;

/** An event's entity by name, and a plugin's scope. */
export interface AuditNames {
  entity_name?: string;
  scope?: { type: string; name: string };
}

const labelOf = (row: Row | undefined, type: unknown) =>
  labelsOf(type)
    .map((field) => row?.[field])
    .find(
      (value): value is string => typeof value === "string" && value !== "",
    );

/** A field's value in an event's diff (the row as created or deleted). */
const fromDiff = (diff: unknown, field: string) =>
  (Array.isArray(diff) ? diff : [])
    .filter(
      (d: { path?: unknown[] }) => d.path?.length === 1 && d.path[0] === field,
    )
    .map((d: { value?: unknown; oldValue?: unknown }) => d.value ?? d.oldValue)
    .find((v) => v !== undefined && v !== null);

/** Filters and a cursor for the audit log. */
export interface AuditQuery {
  actor?: string;
  action?: AuditAction;
  entityType?: string;
  /** The previous page's `next`: events older than it. */
  cursor?: string;
  size?: number;
}

/** The workspace's audit events, newest first. */
export function auditLog(db: DrizzleD1Database, ctx: AuditContext) {
  const t = tables.audit_events;

  /** Rows of an entity table by id, in chunks; none for an unknown type. */
  const rowsOf = async (type: string, ids: string[]) => {
    const table = (tables as unknown as Record<string, Table>)[type];
    const found = new Map<string, Row>();
    if (!table?.id || !table.workspace_id) return found;
    const unique = [...new Set(ids)];
    for (let i = 0; i < unique.length; i += CHUNK) {
      const rows = (await db
        .select()
        .from(table as never)
        .where(
          and(
            eq(table.workspace_id, ctx.workspaceId),
            inArray(table.id, unique.slice(i, i + CHUNK)),
          ),
        )) as Row[];
      for (const row of rows) found.set(String(row.id), row);
    }
    return found;
  };

  /**
   * Each event with its entity's name, from the live row or, once deleted,
   * from the event's own diff; a plugin also names what it's set on, and a
   * credential its consumer ("plugin rate-limiting on route
   * httpbin-anything", "API key on consumer partner-a").
   */
  const named = async <E extends Row>(
    events: E[],
  ): Promise<(E & AuditNames)[]> => {
    const byType = new Map<string, string[]>();
    for (const e of events) {
      if (typeof e.entity_id !== "string") continue;
      const type = String(e.entity_type);
      byType.set(type, [...(byType.get(type) ?? []), e.entity_id]);
    }
    const live = new Map<string, Row>();
    for (const [type, ids] of byType) {
      for (const [id, row] of await rowsOf(type, ids))
        live.set(`${type}:${id}`, row);
    }
    const field = (e: E, name: string) =>
      live.get(`${e.entity_type}:${e.entity_id}`)?.[name] ??
      fromDiff(e.diff, name);
    // What each plugin event is set on, looked up per entity type.
    const scopeIds = new Map<string, string[]>();
    for (const e of events) {
      for (const key of scopeFields(e.entity_type)) {
        const type = SCOPES[key];
        const id = field(e, key);
        if (typeof id === "string")
          scopeIds.set(type, [...(scopeIds.get(type) ?? []), id]);
      }
    }
    const scopes = new Map<string, Row>();
    for (const [type, ids] of scopeIds) {
      for (const [id, row] of await rowsOf(type, ids))
        scopes.set(`${type}:${id}`, row);
    }
    return events.map((e) => {
      const row = live.get(`${e.entity_type}:${e.entity_id}`);
      const name =
        labelOf(row, e.entity_type) ??
        labelsOf(e.entity_type)
          .map((label) => fromDiff(e.diff, label))
          .find((v): v is string => typeof v === "string");
      let scope: AuditNames["scope"];
      for (const key of scopeFields(e.entity_type)) {
        const type = SCOPES[key];
        const id = field(e, key);
        if (typeof id !== "string") continue;
        scope = {
          type,
          name: labelOf(scopes.get(`${type}:${id}`), type) ?? id,
        };
        break;
      }
      return {
        ...e,
        ...(name ? { entity_name: name } : {}),
        ...(scope ? { scope } : {}),
      };
    });
  };

  return {
    list: (limit = 100) =>
      db
        .select()
        .from(t)
        .where(eq(t.workspace_id, ctx.workspaceId))
        .orderBy(desc(t.id))
        .limit(limit),
    /**
     * One page, filtered. Ids are uuidv7, so they sort by time: the cursor
     * is the last id of a page, and `next` is absent on the last page.
     */
    async page(q: AuditQuery = {}) {
      const size = Math.min(
        q.size ?? AUDIT_PAGE.defaultSize,
        AUDIT_PAGE.maxSize,
      );
      const rows = await db
        .select()
        .from(t)
        .where(
          and(
            eq(t.workspace_id, ctx.workspaceId),
            q.actor ? eq(t.actor, q.actor) : undefined,
            q.action ? eq(t.action, q.action) : undefined,
            q.entityType ? eq(t.entity_type, q.entityType) : undefined,
            q.cursor ? lt(t.id, q.cursor) : undefined,
          ),
        )
        .orderBy(desc(t.id))
        .limit(size + 1);
      const data = await named(rows.slice(0, size));
      return rows.length > size
        ? { data, next: data[data.length - 1]?.id }
        : { data };
    },
  };
}
