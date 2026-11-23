/**
 * @edgway/admin-core: the admin service layer shared by the native API and
 * the Kong-compatible mount. Everything is scoped to one workspace and
 * audited in the same D1 batch as the change.
 */
import type { Snapshot } from "@edgway/adapters-cf";
import { PORTAL } from "@edgway/constants";
import { ERR, fail } from "@edgway/errors";
import { tables } from "@edgway/schema";
import { and, desc, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import { auditInsert, auditLog } from "./audit.js";

export { AUDIT_ACTIONS } from "./audit.js";

import { type CoreContext, catalogOf } from "./catalog.js";
import { basicAuthService, keyAuthService } from "./credentials.js";
import {
  CRUD_ENTITIES,
  type CrudEntity,
  constraintError,
  type EntityService,
  entityService,
} from "./entities.js";
import { publisher } from "./publish.js";
import { compileSnapshot, snapshotDiff } from "./snapshot.js";

export type { AuditAction, AuditContext, AuditQuery } from "./audit.js";
export {
  type CatalogPlugin,
  type CoreContext,
  kongCatalog,
  type PluginCatalog,
  type PluginSchema,
  pluginCatalog,
} from "./catalog.js";
export {
  type BasicAuthInput,
  basicAuthHash,
  generateKey,
  type KeyAuthInput,
} from "./credentials.js";
export {
  CRUD_ENTITIES,
  type CrudEntity,
  type EntityService,
  INTERNAL_FIELDS,
  type ListOptions,
  type Page,
  type Row,
} from "./entities.js";
export {
  currentVersion,
  importSigningKeys,
  liveVersion,
  type PublishTarget,
  type PublishWarning,
  publishedSnapshot,
  publishWarnings,
  type RevivedCredential,
  revivedCredentials,
  type VersionSource,
  validatePlugins,
} from "./publish.js";
export { isVaultReference, pluginSecretPaths, redactRow } from "./secrets.js";
export { EMPTY_SNAPSHOT, snapshotDiff } from "./snapshot.js";

/**
 * Ids per query: D1 binds at most 100 parameters.
 * ponytail: inline here; @edgway/constants is its home if another needs it.
 */
const D1_CHUNK = 90;

export function createAdminCore(d1: D1Database, ctx: CoreContext) {
  const db = drizzle(d1);
  const entities = Object.fromEntries(
    CRUD_ENTITIES.map((name) => [name, entityService(db, ctx, name)]),
  ) as Record<CrudEntity, EntityService>;
  const members = tables.consumer_group_consumers;
  const membership = (groupId: string, consumerId: string) =>
    and(
      eq(members.workspace_id, ctx.workspaceId),
      eq(members.consumer_group_id, groupId),
      eq(members.consumer_id, consumerId),
    );

  return {
    ...entities,
    keyAuth: keyAuthService(db, ctx),
    basicAuth: basicAuthService(db, ctx),

    /**
     * Developer-portal accounts: a developer's consumer is
     * found or made by OIDC subject, and an admin can block one. A blocked
     * developer keeps their consumer (so signing in again can't make a new
     * one) and loses their keys (staged; the admin publishes them at once).
     *
     */
    portal: {
      async signIn(subject: string) {
        // A new developer only while the install is under its cap.
        const consumer = await entities.consumers.findOrCreateBy(
          "portal_subject",
          subject,
          {},
          {
            field: "portal_subject",
            anyValue: true,
            max: ctx.maxPortalDevelopers ?? PORTAL.maxDevelopers,
            error: ERR.PORTAL_DEVELOPER_LIMIT,
          },
        );
        const { portal_blocked } = await entities.consumers.internalOf(
          String(consumer.id),
        );
        return { consumer, blocked: portal_blocked === true };
      },
      /**
       * Label a developer's consumer for admins: the first
       * candidate (their verified email, then name, from the IdP) becomes
       * its `display_name`. Never its Kong `username`, which decK,
       * Terraform and plugins match on.
       */
      async label(consumerId: string, candidates: (string | undefined)[]) {
        const consumer = await entities.consumers.get(consumerId);
        const label = candidates.find((candidate) => candidate);
        if (consumer.display_name || !label) return consumer;
        return entities.consumers.update(consumerId, { display_name: label });
      },
      async block(consumerId: string) {
        const { portal_subject } =
          await entities.consumers.internalOf(consumerId);
        // Only a portal developer's consumer can be blocked.
        if (!portal_subject) {
          fail(ERR.ADMIN_INVALID_REQUEST, {
            extensions: { field: "portal_subject" },
          });
        }
        await entities.consumers.setInternal(consumerId, {
          portal_blocked: true,
        });
        // Every key, however it was made (the portal caps only its own).
        const keys = keyAuthService(db, ctx);
        let removed = 0;
        for (;;) {
          const { data } = await keys.list({
            where: { consumer_id: consumerId },
          });
          if (data.length === 0) break;
          for (const key of data) await keys.delete(String(key.id));
          removed += data.length;
        }
        return { blocked: true, keys_removed: removed };
      },
      /**
       * Whether each consumer is a portal developer, and blocked,
       * for the admin's consumer pages. Never the OIDC subject itself.
       */
      async statusOf(ids: string[]) {
        const consumers = tables.consumers;
        const status = new Map<
          string,
          { developer: boolean; blocked: boolean }
        >();
        for (let i = 0; i < ids.length; i += D1_CHUNK) {
          const rows = await db
            .select({
              id: consumers.id,
              subject: consumers.portal_subject,
              blocked: consumers.portal_blocked,
            })
            .from(consumers)
            .where(
              and(
                eq(consumers.workspace_id, ctx.workspaceId),
                inArray(consumers.id, ids.slice(i, i + D1_CHUNK)),
              ),
            );
          for (const row of rows) {
            status.set(row.id, {
              developer: row.subject !== null,
              blocked: row.blocked === true,
            });
          }
        }
        return status;
      },
      async unblock(consumerId: string) {
        await entities.consumers.internalOf(consumerId);
        await entities.consumers.setInternal(consumerId, {
          portal_blocked: false,
        });
        return { blocked: false, keys_removed: 0 };
      },
    },

    /** Consumer-group membership (Kong's `consumer_group_consumers`). */
    groupMembers: {
      list: (groupId: string) =>
        db
          .select()
          .from(members)
          .where(
            and(
              eq(members.workspace_id, ctx.workspaceId),
              eq(members.consumer_group_id, groupId),
            ),
          ),
      async add(groupId: string, consumerId: string) {
        await entities.consumer_groups.get(groupId);
        await entities.consumers.get(consumerId);
        const row = {
          workspace_id: ctx.workspaceId,
          consumer_group_id: groupId,
          consumer_id: consumerId,
        };
        try {
          await db.batch([
            db.insert(members).values(row),
            auditInsert(
              db,
              ctx,
              "create",
              "consumer_group_consumers",
              groupId,
              {},
              row,
            ),
          ]);
        } catch (error) {
          constraintError(error);
        }
      },
      async remove(groupId: string, consumerId: string) {
        const [row] = await db
          .select()
          .from(members)
          .where(membership(groupId, consumerId));
        if (!row) fail(ERR.ADMIN_NOT_FOUND);
        await db.batch([
          db.delete(members).where(membership(groupId, consumerId)),
          auditInsert(
            db,
            ctx,
            "delete",
            "consumer_group_consumers",
            groupId,
            row,
            {},
          ),
        ]);
      },
    },

    audit: auditLog(db, ctx),

    /** The plugins this install's gateway bundles. */
    catalog: catalogOf(ctx),

    /** The data plane's snapshot of the staged configuration. */
    compileSnapshot: () => compileSnapshot(db, ctx),

    /** Publish, rollback and the published versions. */
    config: publisher(db, ctx),

    /** Staged changes not yet published, relative to `published`. */
    async pendingDiff(published?: Snapshot) {
      return snapshotDiff(published, await compileSnapshot(db, ctx));
    },

    /**
     * The staged changes with who staged each: the actor of its
     * entity's latest audit event, and the entity's name and route paths,
     * so a long list can be grouped and searched.
     */
    async pendingChanges(published?: Snapshot) {
      const staged = await compileSnapshot(db, ctx);
      // A table new or emptied since the published version is one change at
      // `[type]` holding every row: one change per entity instead, so each
      // can be named and credited.
      const changes = snapshotDiff(published, staged).flatMap((change) => {
        const rows = (
          change.type === "CREATE"
            ? change.value
            : change.type === "REMOVE"
              ? change.oldValue
              : undefined
        ) as Record<string, unknown> | undefined;
        if (change.path.length !== 1 || !rows || typeof rows !== "object") {
          return [change];
        }
        return Object.entries(rows).map(([key, row]) =>
          change.type === "CREATE"
            ? {
                type: "CREATE" as const,
                path: [change.path[0], key],
                value: row,
              }
            : {
                type: "REMOVE" as const,
                path: [change.path[0], key],
                oldValue: row,
              },
        );
      });
      const ids = [...new Set(changes.map((c) => String(c.path[1])))];
      const actors = new Map<string, string>();
      const audit = tables.audit_events;
      for (let i = 0; i < ids.length; i += D1_CHUNK) {
        const rows = await db
          .select({
            type: audit.entity_type,
            id: audit.entity_id,
            actor: audit.actor,
          })
          .from(audit)
          .where(
            and(
              eq(audit.workspace_id, ctx.workspaceId),
              inArray(audit.entity_id, ids.slice(i, i + D1_CHUNK)),
            ),
          )
          .orderBy(desc(audit.id));
        // Newest first: the first event per entity names who staged it.
        for (const row of rows) {
          const key = `${row.type}:${row.id}`;
          if (!actors.has(key)) actors.set(key, row.actor);
        }
      }
      // Names from the staged tables (the snapshot carries none); a removed
      // entity has no row left, and is shown by its id.
      const names = new Map<string, string>();
      const byType = new Map<string, Set<string>>();
      for (const change of changes) {
        const type = String(change.path[0]);
        byType.set(
          type,
          (byType.get(type) ?? new Set()).add(String(change.path[1])),
        );
      }
      for (const [type, typeIds] of byType) {
        const t = (
          tables as unknown as Record<string, Record<string, SQLiteColumn>>
        )[type];
        const label = t?.name ?? t?.username;
        if (!t?.id || !label) continue;
        const unique = [...typeIds];
        for (let i = 0; i < unique.length; i += D1_CHUNK) {
          const rows = await db
            .select({ id: t.id, label })
            .from(t as never)
            .where(inArray(t.id, unique.slice(i, i + D1_CHUNK)));
          for (const row of rows as { id: string; label: unknown }[]) {
            if (typeof row.label === "string") {
              names.set(`${type}:${row.id}`, row.label);
            }
          }
        }
      }
      // ACLs and group memberships have no id in the snapshot: they're keyed
      // `<consumer>:<group>`. Their audit events name the consumer and group
      // in the diff, so the key is rebuilt from it (membership events are
      // filed under the group's id, ACL events under the ACL row's own id).
      const composite = changes
        .map((c) => [String(c.path[0]), String(c.path[1])] as const)
        .filter(
          ([type]) => type === "acls" || type === "consumer_group_consumers",
        );
      const field = (diff: unknown, name: string) =>
        (diff as { path?: unknown[]; value?: unknown; oldValue?: unknown }[])
          ?.filter((d) => d.path?.[0] === name)
          .map((d) => d.value ?? d.oldValue)
          .find((v) => typeof v === "string") as string | undefined;
      const fromDiff = (
        type: string,
        rows: { diff: unknown; actor: string }[],
      ) => {
        for (const row of rows) {
          const consumer = field(row.diff, "consumer_id");
          const group =
            field(row.diff, "group") ?? field(row.diff, "consumer_group_id");
          const key = `${type}:${consumer}:${group}`;
          if (consumer && group && !actors.has(key)) actors.set(key, row.actor);
        }
      };
      const groupIds = [
        ...new Set(
          composite
            .filter(([type]) => type === "consumer_group_consumers")
            .map(([, key]) => key.split(":")[1] ?? ""),
        ),
      ];
      for (let i = 0; i < groupIds.length; i += D1_CHUNK) {
        fromDiff(
          "consumer_group_consumers",
          await db
            .select({ diff: audit.diff, actor: audit.actor })
            .from(audit)
            .where(
              and(
                eq(audit.workspace_id, ctx.workspaceId),
                eq(audit.entity_type, "consumer_group_consumers"),
                inArray(audit.entity_id, groupIds.slice(i, i + D1_CHUNK)),
              ),
            )
            .orderBy(desc(audit.id)),
        );
      }
      // ACLs can be edited, and an update's diff holds only what changed, so
      // their keys are rebuilt by replaying each ACL's events in order: an
      // event credits the key it leaves the ACL with, and the key it takes
      // away. Oldest first, so the newest event per key wins.
      // ponytail: reads every ACL event in the workspace; a key-indexed audit
      // column would bound it.
      if (composite.some(([type]) => type === "acls")) {
        const events = await db
          .select({ id: audit.entity_id, diff: audit.diff, actor: audit.actor })
          .from(audit)
          .where(
            and(
              eq(audit.workspace_id, ctx.workspaceId),
              eq(audit.entity_type, "acls"),
            ),
          )
          .orderBy(audit.id);
        const state = new Map<string, Record<string, unknown>>();
        const keyOf = (row: Record<string, unknown>) =>
          typeof row.consumer_id === "string" && typeof row.group === "string"
            ? `acls:${row.consumer_id}:${row.group}`
            : undefined;
        for (const event of events) {
          const before = state.get(String(event.id)) ?? {};
          const after = { ...before };
          for (const d of (event.diff ?? []) as {
            type: string;
            path: unknown[];
            value?: unknown;
          }[]) {
            const key = String(d.path[0]);
            if (d.type === "REMOVE") delete after[key];
            else after[key] = d.value;
          }
          state.set(String(event.id), after);
          const was = keyOf(before);
          const now = keyOf(after);
          if (was && was !== now) actors.set(was, event.actor);
          if (now) actors.set(now, event.actor);
        }
      }
      const rowOf = (
        snapshot: Snapshot | undefined,
        type: string,
        id: string,
      ) =>
        (
          (snapshot as Record<string, unknown> | undefined)?.[type] as
            | Record<string, unknown>[]
            | undefined
        )?.find((row) => String(row.id) === id);
      return changes.map((change) => {
        const type = String(change.path[0]);
        const id = String(change.path[1]);
        const row = rowOf(staged, type, id) ?? rowOf(published, type, id);
        const name = names.get(`${type}:${id}`) ?? row?.target;
        return {
          ...change,
          actor: actors.get(`${type}:${id}`),
          entity: {
            ...(typeof name === "string" ? { name } : {}),
            ...(Array.isArray(row?.paths)
              ? { paths: row.paths as string[] }
              : {}),
          },
        };
      });
    },
  };
}

export type AdminCore = ReturnType<typeof createAdminCore>;
