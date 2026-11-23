/**
 * The native admin API (`/api/v1`): @hono/zod-openapi routes over
 * @edgway/admin-core, with request and response schemas from @edgway/schema.
 * Reads need `viewer`, writes `editor`.
 */
import {
  type AdminCore,
  AUDIT_ACTIONS,
  CRUD_ENTITIES,
  INTERNAL_FIELDS,
  liveVersion,
  publishedSnapshot,
  publishWarnings,
  type Row,
  redactRow,
} from "@edgway/admin-core";
import {
  ADMIN_PAGE,
  AUDIT_PAGE,
  HEADER,
  MEDIA_TYPE,
  PUBLISH_WARNING,
} from "@edgway/constants";
import { ERR, fail, STATUS } from "@edgway/errors";
import { type EntityName, entitySchemas, tables } from "@edgway/schema";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { consoleRoutes } from "./console";
import { holds, requireRole } from "./identity";
import { publishTarget, versionSource } from "./publish";
import { type AdminRole, ROLES } from "./roles";

declare module "hono" {
  interface ContextVariableMap {
    adminCore: AdminCore;
  }
}

/** Fields the service sets itself, never taken from a request body. */
const MANAGED = ["id", "workspace_id", "created_at", "updated_at"] as const;

const shapeOf = (schema: z.ZodObject) => Object.keys(schema.shape);

/**
 * A request body: the insert schema without managed fields. Strict, so a
 * field the entity doesn't take (Kong's `service: { id }`, a managed or
 * internal field) is a 400 naming it, not silently dropped.
 */
function bodySchema(name: EntityName, hidden: readonly string[] = []) {
  const insert = entitySchemas[name].insert as unknown as z.ZodObject;
  const omit = Object.fromEntries(
    shapeOf(insert)
      .filter((k) => (MANAGED as readonly string[]).includes(k) && k !== "id")
      .concat(hidden.filter((k) => shapeOf(insert).includes(k)))
      .map((k) => [k, true as const]),
  );
  return insert.omit(omit as never).strict();
}

/** A response row: the select schema without the workspace and hidden fields. */
function rowSchema(name: EntityName, hidden: readonly string[] = []) {
  const select = entitySchemas[name].select as unknown as z.ZodObject;
  const omit = Object.fromEntries(
    ["workspace_id", ...hidden]
      .filter((k) => shapeOf(select).includes(k))
      .map((k) => [k, true as const]),
  );
  return select.omit(omit as never);
}

const idParam = z.object({ id: z.string() });
const pendingQuery = z.object({
  warnings: z.enum(["true", "false"]).optional(),
});
const auditQuery = z.object({
  actor: z.string().optional(),
  action: z.enum(AUDIT_ACTIONS).optional(),
  entity_type: z.string().optional(),
  /** The previous page's `next`. */
  cursor: z.string().optional(),
  size: z.coerce.number().int().min(1).max(AUDIT_PAGE.maxSize).optional(),
});
const listQuery = z.object({
  size: z.coerce.number().int().min(1).max(ADMIN_PAGE.maxSize).optional(),
  offset: z.string().optional(),
  /** Kong's tag filter: `a,b` (all) or `a/b` (any). */
  tags: z.string().optional(),
});

const json = (schema: z.ZodType) => ({
  content: { [MEDIA_TYPE.json]: { schema } },
});

const page = (row: z.ZodType) =>
  z.object({ data: z.array(row), offset: z.string().optional() });

/** Kong's `tags` query: comma for all, slash for any. */
function tagFilter(tags?: string) {
  if (!tags) return undefined;
  const any = tags.includes("/");
  return {
    values: tags.split(any ? "/" : ","),
    match: any ? ("or" as const) : ("and" as const),
  };
}

type Handler = (c: Context) => Promise<Response> | Response;

/** A JSON response without workspace ids: the workspace is the server's own. */
const send = (c: Context, value: unknown, status: number = STATUS.ok) =>
  c.body(
    JSON.stringify(value, (key, v) => (key === "workspace_id" ? undefined : v)),
    status as never,
    { [HEADER.contentType]: MEDIA_TYPE.json },
  );

/**
 * The column `GET /{entity}/{id}` falls back to when the id isn't one: the
 * entity's name, a consumer's username, or else the id itself (an
 * entity without a `name` column answered 400 for every lookup).
 */
function lookupField(entity: EntityName): string {
  // A drizzle table has its columns as properties.
  const table = tables[entity];
  if ("name" in table) return "name";
  if ("username" in table) return "username";
  return "id";
}

/**
 * Entities whose deletion revokes a consumer's access. Not ACLs:
 * dropping a group can grant access under an acl `deny` list.
 */
const REVOKING: ReadonlySet<EntityName> = new Set([
  "consumers",
  "keyauth_credentials",
  "basicauth_credentials",
  "jwt_secrets",
]);

/**
 * A revocation (a blocked developer, a rotated or deleted credential) goes
 * live at once, not with the next full publish. The publish only
 * takes the consumer's revoked credentials out of the live config, so an
 * editor can't publish anything else through it. Before the first publish
 * nothing is live to revoke.
 */
async function revoke(c: Context, consumerId: unknown) {
  if (typeof consumerId !== "string" || !consumerId) return;
  if ((await liveVersion(versionSource(c))) === undefined) return;
  await c
    .get("adminCore")
    .config.publishRevocations(await publishTarget(c), [consumerId]);
}

export function adminApi() {
  const api = new OpenAPIHono({
    // Invalid input is the admin API's 400 problem.
    defaultHook: (result) => {
      if (!result.success) {
        fail(ERR.ADMIN_INVALID_REQUEST, {
          extensions: {
            // An unknown field is one issue per key, at the key.
            issues: result.error.issues.flatMap((i) =>
              i.code === "unrecognized_keys"
                ? i.keys.map((key) => ({
                    path: [...i.path, key].join("."),
                    message: i.message,
                  }))
                : [{ path: i.path.join("."), message: i.message }],
            ),
          },
        });
      }
    },
  });

  /** Register a route that needs `role`. */
  const route = (
    role: AdminRole,
    config: Parameters<typeof createRoute>[0],
    handler: Handler,
  ) =>
    // The role check runs before request validation.
    api.openapi(
      createRoute({ ...config, middleware: [requireRole(role)] }),
      handler as never,
    );

  const core = (c: Context) => c.get("adminCore");
  const valid = <T = Row>(c: Context, target: "json" | "param" | "query") =>
    (c.req.valid as (t: string) => T)(target);

  // Who is signed in, and their role: the console disables what the
  // role can't do. The server's role checks stay the authority.
  const me = z.object({
    id: z.string(),
    email: z.string().optional(),
    role: z.enum(ROLES),
  });
  route(
    "viewer",
    {
      tags: ["identity"],
      method: "get",
      path: "/me",
      operationId: "me",
      responses: { [STATUS.ok]: { ...json(me), description: "identity" } },
    },
    (c) => {
      const principal = c.get("adminPrincipal");
      // The highest role held: Access identities hold one.
      const role = [...ROLES].reverse().find((r) => holds(c, r)) ?? "viewer";
      return c.json({
        id: principal.id,
        ...(principal.email ? { email: principal.email } : {}),
        role,
      });
    },
  );

  /**
   * A consumer's developer-portal status, read-only: whether it's a
   * portal developer and blocked, never the subject. Native API only; the
   * Kong mount and decK never see it.
   */
  const portalStatus = z.object({
    developer: z.boolean(),
    blocked: z.boolean(),
  });
  const withPortal = async (c: Context, name: EntityName, rows: Row[]) => {
    if (name !== "consumers") return rows;
    const status = await core(c).portal.statusOf(rows.map((r) => String(r.id)));
    return rows.map((r) => ({ ...r, portal: status.get(String(r.id)) }));
  };

  for (const name of CRUD_ENTITIES) {
    // Edgway-internal columns (the portal's subject) never cross the API.
    const stored = rowSchema(name, INTERNAL_FIELDS[name]);
    const row =
      name === "consumers"
        ? stored.extend({ portal: portalStatus.optional() })
        : stored;
    const body = bodySchema(name, INTERNAL_FIELDS[name]);
    const tag = { tags: [name] };
    const service = (c: Context) => core(c)[name];
    // Viewers never see secret values; editors edit them.
    const shown = (c: Context, value: Row) =>
      holds(c, "editor") ? value : redactRow(name, value);

    route(
      "viewer",
      {
        ...tag,
        method: "get",
        path: `/${name}`,
        operationId: `list_${name}`,
        request: { query: listQuery },
        responses: { [STATUS.ok]: { ...json(page(row)), description: name } },
      },
      async (c) => {
        const q = valid<z.infer<typeof listQuery>>(c, "query");
        const listed = await service(c).list({
          size: q.size,
          offset: q.offset,
          tags: tagFilter(q.tags),
        });
        return send(c, {
          ...listed,
          data: await withPortal(
            c,
            name,
            listed.data.map((r) => shown(c, r)),
          ),
        });
      },
    );
    route(
      "editor",
      {
        ...tag,
        method: "post",
        path: `/${name}`,
        operationId: `create_${name}`,
        request: { body: json(body) },
        responses: { [STATUS.created]: { ...json(row), description: name } },
      },
      async (c) =>
        send(c, await service(c).create(valid(c, "json")), STATUS.created),
    );
    route(
      "viewer",
      {
        ...tag,
        method: "get",
        path: `/${name}/{id}`,
        operationId: `get_${name}`,
        request: { params: idParam },
        responses: { [STATUS.ok]: { ...json(row), description: name } },
      },
      async (c) => {
        const found = shown(
          c,
          await service(c).lookup(
            valid<{ id: string }>(c, "param").id,
            lookupField(name),
          ),
        );
        const [answer] = await withPortal(c, name, [found]);
        return send(c, answer);
      },
    );
    for (const [method, replace] of [
      ["patch", false],
      ["put", true],
    ] as const) {
      route(
        "editor",
        {
          ...tag,
          method,
          path: `/${name}/{id}`,
          operationId: `${method}_${name}`,
          request: {
            params: idParam,
            body: json(replace ? body : body.partial()),
          },
          responses: { [STATUS.ok]: { ...json(row), description: name } },
        },
        async (c) => {
          const { id } = valid<{ id: string }>(c, "param");
          const found = await service(c).lookup(id);
          return send(
            c,
            await service(c).update(
              String(found.id),
              valid(c, "json"),
              replace,
            ),
          );
        },
      );
    }
    route(
      "editor",
      {
        ...tag,
        method: "delete",
        path: `/${name}/{id}`,
        operationId: `delete_${name}`,
        request: { params: idParam },
        responses: { [STATUS.noContent]: { description: name } },
      },
      async (c) => {
        const found = await service(c).lookup(
          valid<{ id: string }>(c, "param").id,
        );
        await service(c).delete(String(found.id));
        if (REVOKING.has(name)) {
          await revoke(c, name === "consumers" ? found.id : found.consumer_id);
        }
        return c.body(null, STATUS.noContent);
      },
    );
  }

  // Credentials: hashes are never in a response; a raw key only on create/rotate.
  // Every hand-written body is strict, as the entity bodies are.
  const keyRow = rowSchema("keyauth_credentials", ["key_hash"]);
  const keyBody = z
    .object({
      key: z.string().min(1).optional(),
      ttl: z.number().int().positive().nullable().optional(),
      tags: z.array(z.string()).nullable().optional(),
    })
    .strict();
  const issued = json(z.object({ credential: keyRow, key: z.string() }));
  const consumerOf = async (c: Context) =>
    String(
      (
        await core(c).consumers.lookup(
          valid<{ id: string }>(c, "param").id,
          "username",
        )
      ).id,
    );

  route(
    "viewer",
    {
      tags: ["key-auth"],
      method: "get",
      path: "/consumers/{id}/key-auth",
      operationId: "list_key_auth",
      request: { params: idParam },
      responses: {
        [STATUS.ok]: { ...json(page(keyRow)), description: "key-auth" },
      },
    },
    async (c) =>
      send(
        c,
        await core(c).keyAuth.list({
          where: { consumer_id: await consumerOf(c) },
        }),
      ),
  );
  route(
    "editor",
    {
      tags: ["key-auth"],
      method: "post",
      path: "/consumers/{id}/key-auth",
      operationId: "create_key_auth",
      request: { params: idParam, body: json(keyBody) },
      responses: { [STATUS.created]: { ...issued, description: "key-auth" } },
    },
    async (c) =>
      send(
        c,
        await core(c).keyAuth.create({
          ...valid<z.infer<typeof keyBody>>(c, "json"),
          consumer_id: await consumerOf(c),
        }),
        STATUS.created,
      ),
  );
  route(
    "editor",
    {
      tags: ["key-auth"],
      method: "post",
      path: "/key-auth/{id}/rotate",
      operationId: "rotate_key_auth",
      request: { params: idParam },
      responses: { [STATUS.ok]: { ...issued, description: "key-auth" } },
    },
    async (c) => {
      const rotated = await core(c).keyAuth.rotate(
        valid<{ id: string }>(c, "param").id,
      );
      await revoke(c, rotated.credential.consumer_id);
      return send(c, rotated);
    },
  );

  // Developer-portal access: blocking keeps the developer's consumer,
  // so signing in again can't make a new one, and removes its keys, live at
  // once.
  const portalAccess = json(
    z.object({ blocked: z.boolean(), keys_removed: z.number().int() }),
  );
  for (const [method, operationId] of [
    ["post", "block_portal_developer"],
    ["delete", "unblock_portal_developer"],
  ] as const) {
    route(
      "editor",
      {
        tags: ["consumers"],
        method,
        path: "/consumers/{id}/portal-block",
        operationId,
        request: { params: idParam },
        responses: {
          [STATUS.ok]: { ...portalAccess, description: "consumers" },
        },
      },
      async (c) => {
        const id = await consumerOf(c);
        const portal = core(c).portal;
        if (method === "delete") return send(c, await portal.unblock(id));
        const blocked = await portal.block(id);
        await revoke(c, id);
        return send(c, blocked);
      },
    );
  }

  const basicRow = rowSchema("basicauth_credentials", ["password"]);
  const basicBody = z
    .object({
      username: z.string().min(1),
      password: z.string().min(1),
      tags: z.array(z.string()).nullable().optional(),
    })
    .strict();
  route(
    "viewer",
    {
      tags: ["basic-auth"],
      method: "get",
      path: "/consumers/{id}/basic-auth",
      operationId: "list_basic_auth",
      request: { params: idParam },
      responses: {
        [STATUS.ok]: { ...json(page(basicRow)), description: "basic-auth" },
      },
    },
    async (c) =>
      send(
        c,
        await core(c).basicAuth.list({
          where: { consumer_id: await consumerOf(c) },
        }),
      ),
  );
  route(
    "editor",
    {
      tags: ["basic-auth"],
      method: "post",
      path: "/consumers/{id}/basic-auth",
      operationId: "create_basic_auth",
      request: { params: idParam, body: json(basicBody) },
      responses: {
        [STATUS.created]: { ...json(basicRow), description: "basic-auth" },
      },
    },
    async (c) =>
      send(
        c,
        await core(c).basicAuth.create({
          ...valid<z.infer<typeof basicBody>>(c, "json"),
          consumer_id: await consumerOf(c),
        }),
        STATUS.created,
      ),
  );
  route(
    "editor",
    {
      tags: ["basic-auth"],
      method: "patch",
      path: "/basic-auth/{id}",
      operationId: "update_basic_auth",
      request: { params: idParam, body: json(basicBody.partial()) },
      responses: {
        [STATUS.ok]: { ...json(basicRow), description: "basic-auth" },
      },
    },
    async (c) =>
      send(
        c,
        await core(c).basicAuth.update(
          valid<{ id: string }>(c, "param").id,
          valid(c, "json"),
        ),
      ),
  );
  for (const [kind, service] of [
    ["key-auth", "keyAuth"],
    ["basic-auth", "basicAuth"],
  ] as const) {
    route(
      "editor",
      {
        tags: [kind],
        method: "delete",
        path: `/${kind}/{id}`,
        operationId: `delete_${kind.replace("-", "_")}`,
        request: { params: idParam },
        responses: { [STATUS.noContent]: { description: kind } },
      },
      async (c) => {
        const id = valid<{ id: string }>(c, "param").id;
        const { consumer_id } = await core(c)[service].get(id);
        await core(c)[service].delete(id);
        await revoke(c, consumer_id);
        return c.body(null, STATUS.noContent);
      },
    );
  }

  // Consumer-group membership.
  const member = z
    .object({ consumer: z.object({ id: z.string() }).strict() })
    .strict();
  const groupOf = async (c: Context) =>
    String(
      (
        await core(c).consumer_groups.lookup(
          valid<{ id: string }>(c, "param").id,
        )
      ).id,
    );
  route(
    "viewer",
    {
      tags: ["consumer_groups"],
      method: "get",
      path: "/consumer_groups/{id}/consumers",
      operationId: "list_group_members",
      request: { params: idParam },
      responses: {
        [STATUS.ok]: {
          ...json(
            z.object({ data: z.array(z.object({ consumer_id: z.string() })) }),
          ),
          description: "members",
        },
      },
    },
    async (c) => {
      const rows = await core(c).groupMembers.list(await groupOf(c));
      return send(c, {
        data: rows.map((r) => ({ consumer_id: r.consumer_id })),
      });
    },
  );
  route(
    "editor",
    {
      tags: ["consumer_groups"],
      method: "post",
      path: "/consumer_groups/{id}/consumers",
      operationId: "add_group_member",
      request: { params: idParam, body: json(member) },
      responses: { [STATUS.created]: { description: "members" } },
    },
    async (c) => {
      const { consumer } = valid<z.infer<typeof member>>(c, "json");
      await core(c).groupMembers.add(await groupOf(c), consumer.id);
      return c.body(null, STATUS.created);
    },
  );
  route(
    "editor",
    {
      tags: ["consumer_groups"],
      method: "delete",
      path: "/consumer_groups/{id}/consumers/{consumer}",
      operationId: "remove_group_member",
      request: { params: idParam.extend({ consumer: z.string() }) },
      responses: { [STATUS.noContent]: { description: "members" } },
    },
    async (c) => {
      const { consumer } = valid<{ consumer: string }>(c, "param");
      await core(c).groupMembers.remove(await groupOf(c), consumer);
      return c.body(null, STATUS.noContent);
    },
  );

  /** One audit event, newest first in a page (typed). */
  const auditEvent = z.object({
    id: z.string(),
    actor: z.string(),
    action: z.enum(AUDIT_ACTIONS),
    entity_type: z.string(),
    entity_id: z.string().nullable(),
    request_id: z.string().nullable(),
    diff: z.unknown(),
    created_at: z.number(),
    /** Its entity's name, and what a plugin is set on. */
    entity_name: z.string().optional(),
    scope: z.object({ type: z.string(), name: z.string() }).optional(),
  });
  const auditPage = z.object({
    data: z.array(auditEvent),
    next: z.string().optional(),
  });
  /** One staged change, with who staged it and its entity. */
  const pendingChange = z.object({
    type: z.enum(["CREATE", "REMOVE", "CHANGE"]),
    path: z.array(z.union([z.string(), z.number()])),
    value: z.unknown().optional(),
    oldValue: z.unknown().optional(),
    actor: z.string().optional(),
    entity: z
      .object({
        name: z.string().optional(),
        paths: z.array(z.string()).optional(),
      })
      .optional(),
  });
  /** What a publish went ahead with but says. */
  const publishWarning = z.discriminatedUnion("code", [
    z.object({
      code: z.literal(PUBLISH_WARNING.upstreamAlgorithm),
      upstream: z.string(),
      name: z.string().optional(),
      algorithm: z.string(),
      runs_as: z.string(),
    }),
    z.object({
      code: z.literal(PUBLISH_WARNING.rawSecret),
      plugin: z.string(),
      name: z.string(),
      fields: z.array(z.string()),
    }),
  ]);
  const pending = z.object({
    version: z.number().optional(),
    changes: z.array(pendingChange),
    warnings: z.array(publishWarning).optional(),
  });

  route(
    "viewer",
    {
      tags: ["audit"],
      method: "get",
      path: "/audit-events",
      operationId: "list_audit_events",
      // Filters and a cursor, newest first.
      request: { query: auditQuery },
      responses: { [STATUS.ok]: { ...json(auditPage), description: "audit" } },
    },
    async (c) => {
      const q = valid<z.infer<typeof auditQuery>>(c, "query");
      return send(
        c,
        await core(c).audit.page({
          actor: q.actor,
          action: q.action,
          entityType: q.entity_type,
          cursor: q.cursor,
          size: q.size,
        }),
      );
    },
  );

  // Publishing: the pending diff, publish, the version list and rollback.
  route(
    "viewer",
    {
      tags: ["config"],
      method: "get",
      path: "/config/pending",
      operationId: "pending_changes",
      // `warnings=true` adds what publishing now would warn about,
      // from admin-core's own check; off by default, since the staged-change
      // banner asks on every page.
      request: { query: pendingQuery },
      responses: { [STATUS.ok]: { ...json(pending), description: "config" } },
    },
    async (c) => {
      const source = versionSource(c);
      const version = await liveVersion(source);
      const published = await publishedSnapshot(source.kv, version);
      const { warnings } = valid<z.infer<typeof pendingQuery>>(c, "query");
      return send(c, {
        version,
        changes: await core(c).pendingChanges(published),
        ...(warnings === "true"
          ? { warnings: publishWarnings(await core(c).compileSnapshot()) }
          : {}),
      });
    },
  );
  const publishBody = z
    .object({ note: z.string().max(1000).optional() })
    .strict();
  const publishResult = z.object({
    version: z.number(),
    sha256: z.string(),
    diff: z.array(z.unknown()),
    warnings: z.array(publishWarning),
  });
  route(
    "publisher",
    {
      tags: ["config"],
      method: "post",
      path: "/config/publish",
      operationId: "publish",
      request: { body: json(publishBody) },
      responses: {
        [STATUS.created]: { ...json(publishResult), description: "config" },
      },
    },
    async (c) =>
      send(
        c,
        await core(c).config.publish(
          await publishTarget(c),
          valid<z.infer<typeof publishBody>>(c, "json").note,
        ),
        STATUS.created,
      ),
  );
  route(
    "viewer",
    {
      tags: ["config"],
      method: "get",
      path: "/config/versions",
      operationId: "list_versions",
      responses: { [STATUS.ok]: { description: "config" } },
    },
    async (c) =>
      send(c, {
        current: await liveVersion(versionSource(c)),
        data: await core(c).config.list(),
      }),
  );
  const rollbackBody = z
    .object({
      version: z.number().int().positive(),
      /** Say what the rollback would do, credentials it revives included. */
      dry_run: z.boolean().optional(),
    })
    .strict();
  route(
    "publisher",
    {
      tags: ["config"],
      method: "post",
      path: "/config/rollback",
      operationId: "rollback",
      request: { body: json(rollbackBody) },
      responses: { [STATUS.ok]: { description: "config" } },
    },
    async (c) =>
      send(
        c,
        await core(c).config.rollback(
          await publishTarget(c),
          valid<z.infer<typeof rollbackBody>>(c, "json").version,
          { dryRun: valid<z.infer<typeof rollbackBody>>(c, "json").dry_run },
        ),
      ),
  );

  // The admin UI's console: plugin catalog, snapshots, tester, analytics.
  consoleRoutes(route, core);

  return api;
}
