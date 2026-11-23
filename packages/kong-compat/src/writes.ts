/**
 * Kong's write endpoints: `POST` creates, `PUT` upserts by id or name, `PATCH`
 * merges and `DELETE` answers 204 whether or not the entity existed, for
 * every collection and its nested forms, plus consumer-group membership.
 * Writes are staged through admin-core like native ones; publishing is
 * separate. Plugins without a registry entry get Kong's "plugin not enabled".
 */
import { type AdminCore, isVaultReference, type Row } from "@edgway/admin-core";
import { ADMIN_PAGE, SERVICE_URL_PORT } from "@edgway/constants";
import { ERR, fail, STATUS } from "@edgway/errors";
import type { Context, Hono } from "hono";
import { z } from "zod";
import {
  COLLECTIONS,
  type Collection,
  collectionOf,
  findOne,
  NESTED,
} from "./collections.js";
import { EDGWAY_ONLY, edgwayOnly, kongRow } from "./serialize.js";
import { shown } from "./shown.js";

/** Kong's reference fields → the collection and our column. */
export const REFERENCES: Record<string, [string, string]> = {
  service: ["services", "service_id"],
  route: ["routes", "route_id"],
  consumer: ["consumers", "consumer_id"],
  consumer_group: ["consumer_groups", "consumer_group_id"],
  upstream: ["upstreams", "upstream_id"],
  certificate: ["certificates", "certificate_id"],
  client_certificate: ["certificates", "client_certificate_id"],
};

/** Fields Kong sends that the service manages itself. */
export const MANAGED = new Set(["created_at", "updated_at", "ws_id"]);

const isId = (value: string) => z.guid().safeParse(value).success;

async function body(c: Context): Promise<Row> {
  const value: unknown = await c.req.json().catch(() => undefined);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(ERR.ADMIN_INVALID_REQUEST);
  }
  return value as Row;
}

/** A reference (`{ id }`, `{ name }`, or a bare id or name) → its id. */
async function referenceId(
  core: AdminCore,
  collection: string,
  value: unknown,
): Promise<string | null> {
  if (value === null) return null;
  const ref =
    typeof value === "string"
      ? { id: value }
      : ((value ?? {}) as Record<string, unknown>);
  if (typeof ref.id === "string") return ref.id;
  const name = ref.name ?? ref.username ?? ref.target;
  if (typeof name !== "string") {
    fail(ERR.ADMIN_INVALID_REQUEST, { extensions: { field: collection } });
  }
  const row = await (COLLECTIONS[collection] as Collection).lookup(core, name);
  return String(row.id);
}

/** A service `url` → Kong's protocol, host, port and path. */
export function serviceUrl(url: unknown): Row {
  let parsed: URL;
  try {
    parsed = new URL(String(url));
  } catch {
    fail(ERR.ADMIN_INVALID_REQUEST, { extensions: { field: "url" } });
  }
  const protocol = parsed.protocol.replace(/:$/, "");
  const bare = !String(url).slice(parsed.origin.length).startsWith("/");
  return {
    protocol,
    host: parsed.hostname,
    port: parsed.port
      ? Number(parsed.port)
      : (SERVICE_URL_PORT[protocol] ?? SERVICE_URL_PORT.http),
    path: bare ? null : parsed.pathname,
  };
}

/** Kong's request body → an admin-core row. */
async function fromKong(
  core: AdminCore,
  collection: string,
  input: Row,
): Promise<Row> {
  const row: Row = {};
  for (const [key, value] of Object.entries(input)) {
    if (MANAGED.has(key) || EDGWAY_ONLY.has(key)) continue;
    const reference = REFERENCES[key];
    if (reference) {
      row[reference[1]] = await referenceId(core, reference[0], value);
    } else if (key === "url" && collection === "services") {
      Object.assign(row, serviceUrl(value));
    } else {
      row[key] = value;
    }
  }
  return row;
}

/** Nulls in a plugin config mean "unset" (Kong returns them that way). */
export function dropNulls(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, v]) => v !== null)
      .map(([k, v]) => [k, dropNulls(v)]),
  );
}

/**
 * Checks Kong makes at write time: a plugin must be enabled and its config
 * valid; a JWT secret must be a vault reference (secrets never go in D1).
 */
function check(
  core: AdminCore,
  collection: string,
  row: Row,
  current?: Row,
): Row {
  if (collection === "plugins") {
    const name = String(row.name ?? current?.name);
    // Kong's "plugin not enabled": only the gateway's bundled plugins
    //, each validated against its own schema.
    const plugin = core.catalog.get(name);
    if (!plugin) fail(ERR.ADMIN_PLUGIN_NOT_ENABLED, { extensions: { name } });
    const config =
      row.config === undefined
        ? current?.config
        : dropNulls({
            ...(current ? (current.config as Row) : {}),
            ...(row.config as Row),
          });
    const result = plugin.config.safeParse({ config: config ?? {} });
    if (!result.success) {
      fail(ERR.ADMIN_INVALID_REQUEST, {
        extensions: {
          name,
          issues: (result.error?.issues ?? []).map((i) => ({
            path: i.path.map(String).join("."),
            message: i.message,
          })),
        },
      });
    }
    return row.config === undefined ? row : { ...row, config };
  }
  if (collection === "jwts" && row.secret != null) {
    const secret = String(row.secret);
    if (!isVaultReference(secret)) {
      fail(ERR.ADMIN_INVALID_REQUEST, { extensions: { field: "secret" } });
    }
  }
  return row;
}

/** A written row in Kong's shape (key-auth writes carry the raw key). */
function respond(
  c: Context,
  collection: Collection,
  row: Row,
  status: 200 | 201,
) {
  const serialized = (collection.serialize ?? kongRow)(row);
  return c.json(
    typeof row.key === "string" ? { ...serialized, key: row.key } : serialized,
    status,
  );
}

/** Where a nested path writes: the parent's reference column and id. */
type Scope = Record<string, string>;

async function create(c: Context, name: string, scope: Scope) {
  const core = c.get("adminCore");
  const collection = collectionOf(name);
  const row = check(core, name, {
    ...(await fromKong(core, name, await body(c))),
    ...scope,
  });
  return respond(
    c,
    collection,
    await collection.create(core, row),
    STATUS.created,
  );
}

/** Kong's PUT: replace the entity the path names, or create it. */
async function upsert(
  c: Context,
  name: string,
  idOrName: string,
  scope: Scope,
) {
  const core = c.get("adminCore");
  const collection = collectionOf(name);
  // A path naming the entity by its unique field sets that field (Kong's PUT).
  const named = isId(idOrName)
    ? { id: idOrName }
    : collection.field
      ? { [collection.field]: idOrName }
      : fail(ERR.ADMIN_NOT_FOUND);
  const input = {
    ...(await fromKong(core, name, await body(c))),
    ...scope,
    ...(named.id ? {} : named),
  };
  const current = await findOne(core, collection, idOrName, scope);
  if (current) {
    return respond(
      c,
      collection,
      await collection.update(
        core,
        String(current.id),
        { ...check(core, name, input), ...edgwayOnly(current) },
        true,
      ),
      STATUS.ok,
    );
  }
  const row = check(core, name, { ...input, ...named });
  return respond(c, collection, await collection.create(core, row), STATUS.ok);
}

async function patch(c: Context, name: string, idOrName: string, scope: Scope) {
  const core = c.get("adminCore");
  const collection = collectionOf(name);
  const current = await findOne(core, collection, idOrName, scope);
  if (!current) fail(ERR.ADMIN_NOT_FOUND);
  const row = check(
    core,
    name,
    { ...(await fromKong(core, name, await body(c))), ...scope },
    current,
  );
  return respond(
    c,
    collection,
    await collection.update(core, String(current.id), row, false),
    STATUS.ok,
  );
}

async function remove(
  c: Context,
  name: string,
  idOrName: string,
  scope: Scope,
) {
  const core = c.get("adminCore");
  const collection = collectionOf(name);
  const current = await findOne(core, collection, idOrName, scope);
  if (current) await collection.remove(core, String(current.id));
  return c.body(null, STATUS.noContent);
}

/** The ids a membership body names (`consumer` or `group`: one or a list). */
async function members(
  core: AdminCore,
  collection: string,
  value: unknown,
): Promise<string[]> {
  const refs = Array.isArray(value) ? value : [value];
  if (refs.length === 0 || refs.some((r) => typeof r !== "string")) {
    fail(ERR.ADMIN_INVALID_REQUEST);
  }
  const rows = await Promise.all(
    refs.map((ref) =>
      (COLLECTIONS[collection] as Collection).lookup(core, String(ref)),
    ),
  );
  return rows.map((row) => String(row.id));
}

async function groupsOf(core: AdminCore, consumerId: string) {
  const { data } = await core.consumer_groups.list({
    size: ADMIN_PAGE.maxSize,
  });
  const memberships = await Promise.all(
    data.map(async (group) => ({
      group,
      members: await core.groupMembers.list(String(group.id)),
    })),
  );
  return memberships
    .filter((m) => m.members.some((r) => r.consumer_id === consumerId))
    .map((m) => m.group);
}

export function registerWrites(app: Hono) {
  const lookupParent = (c: Context, parent: string) =>
    (COLLECTIONS[parent] as Collection).lookup(
      c.get("adminCore"),
      c.req.param("parent") as string,
    );

  // Consumer-group membership, from either side.
  app.get("/consumer_groups/:parent/consumers", async (c) => {
    const core = c.get("adminCore");
    const group = await lookupParent(c, "consumer_groups");
    const rows = await core.groupMembers.list(String(group.id));
    const consumers = await Promise.all(
      rows.map((m) => core.consumers.get(String(m.consumer_id))),
    );
    return c.json({ data: consumers.map(kongRow), next: null });
  });
  app.post("/consumer_groups/:parent/consumers", async (c) => {
    const core = c.get("adminCore");
    const group = await lookupParent(c, "consumer_groups");
    const ids = await members(core, "consumers", (await body(c)).consumer);
    for (const id of ids) await core.groupMembers.add(String(group.id), id);
    const consumers = await Promise.all(
      ids.map((id) => core.consumers.get(id)),
    );
    return c.json(
      { consumer_group: kongRow(group), consumers: consumers.map(kongRow) },
      STATUS.created,
    );
  });
  app.delete("/consumer_groups/:parent/consumers/:consumer", async (c) => {
    const core = c.get("adminCore");
    const group = await lookupParent(c, "consumer_groups");
    const [consumer] = await members(
      core,
      "consumers",
      c.req.param("consumer"),
    );
    await core.groupMembers.remove(String(group.id), String(consumer));
    return c.body(null, STATUS.noContent);
  });
  app.get("/consumers/:parent/consumer_groups", async (c) => {
    const consumer = await lookupParent(c, "consumers");
    const groups = await groupsOf(c.get("adminCore"), String(consumer.id));
    return c.json({ data: groups.map(kongRow), next: null });
  });
  app.post("/consumers/:parent/consumer_groups", async (c) => {
    const core = c.get("adminCore");
    const consumer = await lookupParent(c, "consumers");
    const ids = await members(core, "consumer_groups", (await body(c)).group);
    for (const id of ids) await core.groupMembers.add(id, String(consumer.id));
    const groups = await Promise.all(
      ids.map((id) => core.consumer_groups.get(id)),
    );
    return c.json(
      { consumer: kongRow(consumer), consumer_groups: groups.map(kongRow) },
      STATUS.created,
    );
  });
  app.delete("/consumers/:parent/consumer_groups/:group", async (c) => {
    const core = c.get("adminCore");
    const consumer = await lookupParent(c, "consumers");
    const [group] = await members(
      core,
      "consumer_groups",
      c.req.param("group"),
    );
    await core.groupMembers.remove(String(group), String(consumer.id));
    return c.body(null, STATUS.noContent);
  });

  // Nested writes: the parent in the path sets the reference.
  for (const [parent, segment, child, column] of NESTED) {
    const scope = async (c: Context): Promise<Scope> => ({
      [column]: String((await lookupParent(c, parent)).id),
    });
    const base = `/${parent}/:parent/${segment}`;
    app.post(base, async (c) => create(c, child, await scope(c)));
    if (child !== "targets") {
      app.get(`${base}/:id`, async (c) => {
        const core = c.get("adminCore");
        const collection = collectionOf(child);
        const row = await findOne(
          core,
          collection,
          c.req.param("id"),
          await scope(c),
        );
        if (!row) fail(ERR.ADMIN_NOT_FOUND);
        return c.json(shown(c, child, (collection.serialize ?? kongRow)(row)));
      });
    }
    app.put(`${base}/:id`, async (c) =>
      upsert(c, child, c.req.param("id"), await scope(c)),
    );
    app.patch(`${base}/:id`, async (c) =>
      patch(c, child, c.req.param("id"), await scope(c)),
    );
    app.delete(`${base}/:id`, async (c) =>
      remove(c, child, c.req.param("id"), await scope(c)),
    );
  }

  for (const name of Object.keys(COLLECTIONS)) {
    app.post(`/${name}`, (c) => create(c, name, {}));
    app.put(`/${name}/:id`, (c) => upsert(c, name, c.req.param("id"), {}));
    app.patch(`/${name}/:id`, (c) => patch(c, name, c.req.param("id"), {}));
    app.delete(`/${name}/:id`, (c) => remove(c, name, c.req.param("id"), {}));
  }
}
