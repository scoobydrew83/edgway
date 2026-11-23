/**
 * Workspace-scoped CRUD for Kong's entities over D1 (drizzle-orm). Every
 * write runs in one D1 `batch()` with its audit event, so a change and its
 * audit row land or fail together. Rows are validated with the entity's
 * drizzle-zod insert schema from @edgway/schema.
 */
import { ADMIN_PAGE, SANDBOX } from "@edgway/constants";
import { type EdgwayError, ERR, fail } from "@edgway/errors";
import { adminRoutePath, adminSandboxLimit, t } from "@edgway/i18n";
import {
  type EntityName,
  entitySchemas,
  isPluginName,
  kongSchema,
  tables,
} from "@edgway/schema";
import {
  and,
  asc,
  eq,
  exists,
  getTableColumns,
  gt,
  isNotNull,
  notExists,
  or,
  SQL,
  sql,
} from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";
import { uuidv7 } from "uuidv7";
import { auditInsert } from "./audit.js";
import { type CoreContext, catalogOf, checkPluginConfig } from "./catalog.js";
import { isVaultReference } from "./secrets.js";

export type Row = Record<string, unknown>;

/** At most `max` rows per value of `field` (in the workspace); else `error`. */
export interface CreateLimit {
  field: string;
  max: number;
  error: EdgwayError;
  /**
   * Count every row with `field` set (any value), not only rows sharing
   * this one's value: e.g. all portal developers.
   */
  anyValue?: boolean;
}

/** A table with the columns every entity shares. */
type EntityTable = SQLiteTable & {
  id: SQLiteColumn;
  workspace_id: SQLiteColumn;
  tags?: SQLiteColumn;
};

/** Entities with their own CRUD (credentials with hashes have their own services). */
export const CRUD_ENTITIES = [
  "certificates",
  "ca_certificates",
  "services",
  "routes",
  "upstreams",
  "targets",
  "snis",
  "vaults",
  "consumers",
  "consumer_groups",
  "plugins",
  "jwt_secrets",
  "acls",
  "sandbox_plugins",
] as const satisfies readonly EntityName[];

export type CrudEntity = (typeof CRUD_ENTITIES)[number];

export interface ListOptions {
  /** Page size; Kong's default and maximum apply. */
  size?: number;
  /** The `offset` a previous page returned. */
  offset?: string;
  /** Kong's tag filter: every tag must match (`and`) or any (`or`). */
  tags?: { values: string[]; match: "and" | "or" };
  /** Extra column filters (e.g. a consumer's credentials). */
  where?: Record<string, string>;
}

export interface Page<T> {
  data: T[];
  /** Pass back as `offset` for the next page; absent on the last page. */
  offset?: string;
}

export const table = (name: EntityName) =>
  tables[name] as unknown as EntityTable;

const column = (t: EntityTable, name: string) =>
  (t as unknown as Record<string, SQLiteColumn>)[name] as SQLiteColumn;

/** Reference columns, and the entity each must name in the same workspace. */
const REFERENCES: Record<string, EntityName> = {
  service_id: "services",
  route_id: "routes",
  consumer_id: "consumers",
  consumer_group_id: "consumer_groups",
  upstream_id: "upstreams",
  certificate_id: "certificates",
  client_certificate_id: "certificates",
};

/**
 * Foreign keys are single-column in D1, so they can't see workspaces: every
 * referenced id (and `ca_certificates` ids) must exist in this workspace.
 */
async function checkReferences(
  db: DrizzleD1Database,
  workspaceId: string,
  row: Row,
): Promise<void> {
  const wanted: [EntityName, string][] = Object.entries(REFERENCES)
    .filter(([field]) => typeof row[field] === "string")
    .map(([field, entity]) => [entity, row[field] as string]);
  if (Array.isArray(row.ca_certificates)) {
    for (const id of row.ca_certificates)
      wanted.push(["ca_certificates", String(id)]);
  }
  for (const [entity, id] of wanted) {
    const t = table(entity);
    const [found] = await db
      .select({ id: t.id })
      .from(t)
      .where(and(eq(t.workspace_id, workspaceId), eq(t.id, id)))
      .limit(1);
    if (!found) {
      fail(ERR.ADMIN_INVALID_REQUEST, {
        extensions: { constraint: "foreign_key", entity, id },
      });
    }
  }
}

/**
 * A plugin instance names a plugin the gateway bundles, with a config its
 * schema accepts (Kong's, or the plugin's own `definePlugin` schema),
 * or a staged uploaded plugin: checked at write time, as the Kong mount does
 *.
 */
async function checkPlugin(
  db: DrizzleD1Database,
  ctx: CoreContext,
  row: Row,
): Promise<void> {
  const name = String(row.name);
  const bundled = catalogOf(ctx).get(name);
  if (bundled) return checkPluginConfig(bundled, row.config);
  const uploaded = tables.sandbox_plugins;
  const [found] = await db
    .select({ id: uploaded.id })
    .from(uploaded)
    .where(
      and(eq(uploaded.workspace_id, ctx.workspaceId), eq(uploaded.name, name)),
    )
    .limit(1);
  if (!found) fail(ERR.ADMIN_PLUGIN_NOT_ENABLED, { extensions: { name } });
}

/** Columns the service manages itself. */
const MANAGED = new Set(["id", "workspace_id", "created_at", "updated_at"]);

/**
 * Edgway-internal columns: never returned, filtered on or set through the
 * entity APIs (native or Kong), and kept as they are by updates. They are
 * set only by `findOrCreateBy` (the developer portal's OIDC subject, so
 * a developer can't claim a consumer an admin made) and `setInternal` (an
 * admin blocking a portal developer).
 */
export const INTERNAL_FIELDS: Partial<Record<EntityName, readonly string[]>> = {
  consumers: ["portal_subject", "portal_blocked"],
};

/**
 * Kong's PUT: fields the body omits go back to their defaults, or null.
 * SQL-expression defaults (timestamps) are managed columns and skipped.
 */
function replacement(t: EntityTable, body: Row): Row {
  const reset: Row = {};
  for (const [key, col] of Object.entries(getTableColumns(t))) {
    if (key in body || MANAGED.has(key)) continue;
    if (col.default !== undefined && !(col.default instanceof SQL)) {
      reset[key] = col.default;
    } else if (!col.notNull) {
      reset[key] = null;
    }
  }
  return { ...reset, ...body };
}

/** A D1 constraint failure, mapped to the admin API's errors. */
export function constraintError(error: unknown): never {
  const message = String((error as Error)?.message ?? error);
  if (message.includes("UNIQUE constraint failed")) fail(ERR.ADMIN_CONFLICT);
  if (message.includes("FOREIGN KEY constraint failed")) {
    fail(ERR.ADMIN_INVALID_REQUEST, {
      extensions: { constraint: "foreign_key" },
    });
  }
  throw error;
}

/**
 * Kong's rule for a route path: it starts with "/", or with "~" for a
 * regular expression. The schemas take any string, so it's checked
 * here, where the admin API, decK and the UI all pass.
 */
function routePathIssues(row: Row) {
  const paths = Array.isArray(row.paths) ? row.paths : [];
  return paths.flatMap((path, i) =>
    typeof path === "string" && /^[/~]/.test(path)
      ? []
      : [{ path: `paths.${i}`, message: t(adminRoutePath) }],
  );
}

/**
 * An uploaded plugin's limits stay within the sandbox's, so the
 * gateway never has to clamp what the admin stored.
 */
function sandboxLimitIssues(row: Row) {
  const limits = {
    cpu_ms: SANDBOX.maxCpuMs,
    sub_requests: SANDBOX.maxSubRequests,
  };
  return Object.entries(limits).flatMap(([field, max]) => {
    const value = row[field];
    return value === null ||
      value === undefined ||
      (typeof value === "number" && value >= 1 && value <= max)
      ? []
      : [{ path: field, message: t(adminSandboxLimit, { max }) }];
  });
}

/** Validate a row with the entity's insert schema; 400 with the issues. */
function validate(name: EntityName, row: Row): Row {
  const result = entitySchemas[name].insert.safeParse(row);
  const issues = [
    ...(result.error?.issues ?? []).map((i) => ({
      path: i.path.join("."),
      message: i.message,
    })),
    ...(name === "routes" ? routePathIssues(row) : []),
    ...(name === "sandbox_plugins" ? sandboxLimitIssues(row) : []),
  ];
  if (!result.success || issues.length > 0) {
    fail(ERR.ADMIN_INVALID_REQUEST, { extensions: { issues } });
  }
  if (name === "sandbox_plugins") checkSandboxPlugin(result.data as Row);
  if (name === "jwt_secrets") checkJwtSecret(result.data as Row);
  if (name === "certificates") checkCertificateKeys(result.data as Row);
  return result.data as Row;
}

/**
 * A jwt secret is stored as a vault reference only, as on the Kong mount
 *: the gateway resolves it, and D1 never holds the secret itself.
 */
function checkJwtSecret(row: Row): void {
  if (row.secret !== null && row.secret !== undefined) {
    if (!isVaultReference(row.secret)) {
      fail(ERR.ADMIN_INVALID_REQUEST, { extensions: { field: "secret" } });
    }
  }
}

/**
 * A certificate's private keys are stored as vault references only, like jwt
 * secrets: D1 never holds a private key.
 */
function checkCertificateKeys(row: Row): void {
  for (const field of ["key", "key_alt"]) {
    const value = row[field];
    if (value !== null && value !== undefined && !isVaultReference(value)) {
      fail(ERR.ADMIN_INVALID_REQUEST, { extensions: { field } });
    }
  }
}

/**
 * An uploaded plugin can't take a bundled Kong plugin's name (the
 * bundled one would always win), and its source has a size limit.
 */
function checkSandboxPlugin(row: Row): void {
  if (isPluginName(String(row.name))) {
    fail(ERR.ADMIN_INVALID_REQUEST, {
      extensions: { field: "name", name: row.name },
    });
  }
  const bytes = new TextEncoder().encode(String(row.code)).byteLength;
  if (bytes > SANDBOX.maxCodeBytes) {
    fail(ERR.ADMIN_INVALID_REQUEST, {
      extensions: { field: "code", bytes, limit: SANDBOX.maxCodeBytes },
    });
  }
}

export function entityService(
  db: DrizzleD1Database,
  ctx: CoreContext,
  name: EntityName,
  /** Fields never returned or audited (hashes). */
  hidden: readonly string[] = [],
) {
  const t = table(name);
  const internal = INTERNAL_FIELDS[name] ?? [];
  const unseen = [...hidden, ...internal];
  const scoped = (...conditions: (SQL | undefined)[]) =>
    and(eq(t.workspace_id, ctx.workspaceId), ...conditions);
  const visible = (row: Row): Row =>
    Object.fromEntries(
      Object.entries(row).filter(([k]) => !unseen.includes(k)),
    );
  /** A request's fields without the internal ones. */
  const external = (input: Row): Row =>
    Object.fromEntries(
      Object.entries(input).filter(([k]) => !internal.includes(k)),
    );

  /** Only known, visible columns can be filtered or looked up on. */
  const checkField = (field: string) => {
    if (!(field in getTableColumns(t)) || unseen.includes(field)) {
      fail(ERR.ADMIN_INVALID_REQUEST, { extensions: { field } });
    }
  };

  async function find(id: string): Promise<Row | undefined> {
    const [row] = await db
      .select()
      .from(t)
      .where(scoped(eq(t.id, id)))
      .limit(1);
    return row as Row | undefined;
  }

  async function mustFind(id: string): Promise<Row> {
    const row = await find(id);
    if (!row) fail(ERR.ADMIN_NOT_FOUND, { extensions: { entity: name, id } });
    return row;
  }

  const service = {
    name,

    async list(options: ListOptions = {}): Promise<Page<Row>> {
      const size = Math.min(
        Math.max(1, options.size ?? ADMIN_PAGE.defaultSize),
        ADMIN_PAGE.maxSize,
      );
      // A tag matches an element of the row's JSON array (SQLite json_each).
      const element = sql`value`;
      const tagFilters = (options.tags?.values ?? []).map((tag) =>
        exists(
          db
            .select({ value: element })
            .from(sql`json_each(${t.tags})`)
            .where(eq(element, tag)),
        ),
      );
      const tagged =
        options.tags?.match === "or" ? or(...tagFilters) : and(...tagFilters);
      const rows = (await db
        .select()
        .from(t)
        .where(
          scoped(
            options.offset ? gt(t.id, options.offset) : undefined,
            tagged,
            ...Object.entries(options.where ?? {}).map(([k, v]) => {
              checkField(k);
              return eq(column(t, k), v);
            }),
          ),
        )
        .orderBy(asc(t.id))
        .limit(size + 1)) as Row[];
      const data = rows.slice(0, size).map(visible);
      return {
        data,
        offset:
          rows.length > size ? String(data[data.length - 1]?.id) : undefined,
      };
    },

    async get(id: string): Promise<Row> {
      return visible(await mustFind(id));
    },

    /** Find by id or by a unique field (Kong's `{id or name}` lookups). */
    async lookup(idOrName: string, field = "name"): Promise<Row> {
      checkField(field);
      const byId = await find(idOrName);
      if (byId) return visible(byId);
      const [row] = (await db
        .select()
        .from(t)
        .where(scoped(eq(column(t, field), idOrName)))
        .limit(1)) as Row[];
      if (!row) {
        fail(ERR.ADMIN_NOT_FOUND, {
          extensions: { entity: name, id: idOrName },
        });
      }
      return visible(row);
    },

    /**
     * Create a row. With `limit`, at most `max` rows may share the new row's
     * `field` value: checked in the same D1 batch (a transaction), so
     * concurrent creates can't pass it together.
     */
    async create(
      input: Row,
      internalValues: Row = {},
      limit?: CreateLimit,
    ): Promise<Row> {
      const row = validate(name, {
        ...external(input),
        ...internalValues,
        id: input.id ?? uuidv7(),
        workspace_id: ctx.workspaceId,
      });
      await checkReferences(db, ctx.workspaceId, row);
      if (name === "plugins") await checkPlugin(db, ctx, row);
      const id = row.id as string;
      const insert = db
        .insert(t)
        .values(row as never)
        .returning();
      const audit = auditInsert(db, ctx, "create", name, id, {}, visible(row));
      let results: unknown[];
      try {
        if (!limit) {
          results = await db.batch([insert, audit]);
        } else {
          // An internal field (the portal's subject) only by the service.
          if (!internal.includes(limit.field)) checkField(limit.field);
          const field = column(t, limit.field);
          const events = tables.audit_events;
          // Over the limit after this insert: the row and its audit event
          // are taken back in the same transaction.
          results = await db.batch([
            insert,
            audit,
            db
              .delete(t)
              .where(
                and(
                  eq(t.id, id),
                  gt(
                    db.$count(
                      t,
                      and(
                        eq(t.workspace_id, ctx.workspaceId),
                        limit.anyValue
                          ? isNotNull(field)
                          : eq(field, row[limit.field]),
                      ),
                    ),
                    limit.max,
                  ),
                ),
              )
              .returning({ id: t.id }),
            db
              .delete(events)
              .where(
                and(
                  eq(events.workspace_id, ctx.workspaceId),
                  eq(events.entity_id, id),
                  notExists(
                    db.select({ id: t.id }).from(t).where(eq(t.id, id)),
                  ),
                ),
              ),
          ]);
        }
      } catch (error) {
        constraintError(error);
      }
      if (limit && (results[2] as Row[]).length > 0) {
        fail(limit.error, { extensions: { limit: limit.max } });
      }
      return visible((results[0] as Row[])[0] as Row);
    },

    /** Merge `patch` into the entity (Kong's PATCH); `replace` for PUT. */
    async update(id: string, patch: Row, replace = false): Promise<Row> {
      const before = await mustFind(id);
      const changes = external(patch);
      const kept = Object.fromEntries(internal.map((k) => [k, before[k]]));
      const next = validate(name, {
        ...(replace ? replacement(t, changes) : { ...before, ...changes }),
        ...kept,
        id,
        workspace_id: ctx.workspaceId,
        created_at: before.created_at,
      });
      await checkReferences(db, ctx.workspaceId, next);
      if (name === "plugins") await checkPlugin(db, ctx, next);
      // updated_at is set by the column's $onUpdateFn.
      const { id: _id, workspace_id: _ws, updated_at: _u, ...values } = next;
      try {
        const [updated] = await db.batch([
          db
            .update(t)
            .set(values as never)
            .where(scoped(eq(t.id, id)))
            .returning(),
          auditInsert(
            db,
            ctx,
            "update",
            name,
            id,
            visible(before),
            visible(next),
          ),
        ]);
        return visible((updated as Row[])[0] as Row);
      } catch (error) {
        constraintError(error);
      }
    },

    /**
     * The row whose internal `field` is `value`, created with it (and
     * `input`) when there is none. Two first calls at once: the loser finds
     * the winner's row.
     */
    async findOrCreateBy(
      field: string,
      value: string,
      input: Row = {},
      limit?: CreateLimit,
    ) {
      if (!internal.includes(field)) {
        fail(ERR.ADMIN_INVALID_REQUEST, { extensions: { field } });
      }
      const existing = async () => {
        const [row] = (await db
          .select()
          .from(t)
          .where(scoped(eq(column(t, field), value)))
          .limit(1)) as Row[];
        return row && visible(row);
      };
      const found = await existing();
      if (found) return found;
      try {
        return await service.create(input, { [field]: value }, limit);
      } catch (error) {
        const raced = await existing();
        if (raced) return raced;
        throw error;
      }
    },

    /**
     * Replace every row whose `field` is `value` with one new row, in one D1
     * batch (a transaction), audited: concurrent calls leave exactly one row
     * (the portal's roll).
     */
    async replaceAll(field: string, value: unknown, input: Row): Promise<Row> {
      checkField(field);
      const row = validate(name, {
        ...external(input),
        [field]: value,
        id: input.id ?? uuidv7(),
        workspace_id: ctx.workspaceId,
      });
      await checkReferences(db, ctx.workspaceId, row);
      const old = (await db
        .select()
        .from(t)
        .where(scoped(eq(column(t, field), value)))) as Row[];
      const id = row.id as string;
      try {
        const [, inserted] = await db.batch([
          db.delete(t).where(scoped(eq(column(t, field), value))),
          db
            .insert(t)
            .values(row as never)
            .returning(),
          ...old.map((before) =>
            auditInsert(
              db,
              ctx,
              "delete",
              name,
              String(before.id),
              visible(before),
              {},
            ),
          ),
          auditInsert(db, ctx, "create", name, id, {}, visible(row)),
        ]);
        return visible((inserted as Row[])[0] as Row);
      } catch (error) {
        constraintError(error);
      }
    },

    /** A row's internal fields (never part of `get`). */
    async internalOf(id: string): Promise<Row> {
      const row = await mustFind(id);
      return Object.fromEntries(internal.map((k) => [k, row[k]]));
    },

    /** Set internal fields, audited; nothing else changes. */
    async setInternal(id: string, values: Row): Promise<void> {
      for (const field of Object.keys(values)) {
        if (!internal.includes(field)) {
          fail(ERR.ADMIN_INVALID_REQUEST, { extensions: { field } });
        }
      }
      const before = await mustFind(id);
      const prior = Object.fromEntries(
        Object.keys(values).map((k) => [k, before[k]]),
      );
      try {
        await db.batch([
          db
            .update(t)
            .set(values as never)
            .where(scoped(eq(t.id, id))),
          auditInsert(db, ctx, "update", name, id, prior, values),
        ]);
      } catch (error) {
        constraintError(error);
      }
    },

    async delete(id: string): Promise<void> {
      const before = await mustFind(id);
      try {
        await db.batch([
          db.delete(t).where(scoped(eq(t.id, id))),
          auditInsert(db, ctx, "delete", name, id, visible(before), {}),
        ]);
      } catch (error) {
        constraintError(error);
      }
    },
  };
  return service;
}

export type EntityService = ReturnType<typeof entityService>;
