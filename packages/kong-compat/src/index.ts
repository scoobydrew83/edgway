/**
 * @edgway/kong-compat: the Kong 3.9 Admin API read surface decK and Kong's
 * Terraform provider call (`GET /`, `/status`, paged collections with Kong's
 * `{ data, next, offset }` and `tags` filter, lookups by id or name, nested
 * collections and `/schemas`) and its writes (./writes), over
 * @edgway/admin-core. The caller mounts it behind its own authentication and
 * role checks, and puts `adminCore` on the context.
 */
import type { AdminCore, ListOptions, Row } from "@edgway/admin-core";
import { ADMIN_PAGE, KONG_COMPAT } from "@edgway/constants";
import { ERR, fail } from "@edgway/errors";
import { type Context, Hono } from "hono";
import {
  COLLECTIONS,
  type Collection,
  collectionOf,
  EMPTY,
  NESTED,
} from "./collections.js";
import { EMPTY_SCHEMAS, entitySchema, pluginSchema } from "./schemas.js";
import { kongPlugin, kongRow } from "./serialize.js";
import { shown } from "./shown.js";
import { validateEntity, validatePlugin } from "./validate.js";
import { registerWrites } from "./writes.js";

declare module "hono" {
  interface ContextVariableMap {
    adminCore: AdminCore;
    /** Set by the caller for viewer tokens: reads mask secrets. */
    kongRedactSecrets?: boolean;
  }
}

/** Kong's `tags` query: `a,b` means all of them, `a/b` any of them. */
function tagFilter(tags: string | undefined): ListOptions["tags"] {
  if (!tags) return undefined;
  const any = tags.includes("/");
  return { values: tags.split(any ? "/" : ","), match: any ? "or" : "and" };
}

function listOptions(c: Context): ListOptions {
  const size = Number(c.req.query("size") ?? ADMIN_PAGE.defaultSize);
  if (!Number.isInteger(size) || size < 1 || size > ADMIN_PAGE.maxSize) {
    fail(ERR.ADMIN_INVALID_REQUEST, { extensions: { field: "size" } });
  }
  return {
    size,
    offset: c.req.query("offset") || undefined,
    tags: tagFilter(c.req.query("tags")),
  };
}

/** Kong's page: `data`, the `offset` to continue from, and the `next` URL. */
async function page(
  c: Context,
  name: string,
  collection: Collection,
  options: ListOptions,
) {
  const result = await collection.list(c.get("adminCore"), options);
  const serialize = (row: Row) =>
    shown(c, name, (collection.serialize ?? kongRow)(row));
  const next = result.offset
    ? `${c.req.path}?${new URLSearchParams({
        offset: result.offset,
        size: String(options.size),
        ...(c.req.query("tags") ? { tags: String(c.req.query("tags")) } : {}),
      })}`
    : null;
  return c.json({
    data: result.data.map(serialize),
    next,
    offset: result.offset ?? null,
  });
}

/**
 * The Kong Admin API, also under Kong's default workspace (`/default/...`),
 * which Kong OSS serves too and Kong's Terraform provider calls.
 * Any other workspace answers Kong's 404.
 */
export function kongAdminApi() {
  const routes = kongRoutes();
  const app = new Hono();
  app.route(`/${KONG_COMPAT.defaultWorkspace}`, routes);
  app.route("/", routes);
  return app;
}

function kongRoutes() {
  const app = new Hono();

  app.get("/", (c) =>
    c.json({
      version: KONG_COMPAT.version,
      tagline: KONG_COMPAT.tagline,
      hostname: KONG_COMPAT.hostname,
      configuration: { database: KONG_COMPAT.database },
      plugins: {
        // What this gateway runs, not every vendored schema.
        available_on_server: Object.fromEntries(
          [...c.get("adminCore").catalog.keys()].map((name) => [
            name,
            { version: KONG_COMPAT.version },
          ]),
        ),
        enabled_in_cluster: [],
      },
    }),
  );

  app.get("/status", (c) =>
    c.json({ database: { reachable: true }, server: {} }),
  );

  app.get("/schemas/plugins/:name", (c) => {
    const schema = pluginSchema(c.req.param("name"));
    if (!schema) fail(ERR.ADMIN_NOT_FOUND);
    return c.json(schema);
  });
  // Schema validation, as decK's `gateway validate` calls it.
  app.post("/schemas/plugins/validate", validatePlugin);
  app.post("/schemas/:entity/validate", validateEntity);
  app.get("/schemas/:entity", (c) => {
    const entity = c.req.param("entity");
    if (EMPTY_SCHEMAS.has(entity)) return c.json({ fields: [] });
    const schema = entitySchema(entity);
    if (!schema) fail(ERR.ADMIN_NOT_FOUND);
    return c.json(schema);
  });

  for (const name of EMPTY) {
    app.get(`/${name}`, (c) => c.json({ data: [], next: null, offset: null }));
  }

  for (const [parent, segment, child, column] of NESTED) {
    app.get(`/${parent}/:parent/${segment}`, async (c) => {
      const owner = await (COLLECTIONS[parent] as Collection).lookup(
        c.get("adminCore"),
        c.req.param("parent"),
      );
      return page(c, child, collectionOf(child), {
        ...listOptions(c),
        where: { [column]: String(owner.id) },
      });
    });
  }

  // Kong answers a consumer group with its members and plugins (decK reads it).
  app.get("/consumer_groups/:id", async (c) => {
    const core = c.get("adminCore");
    const group = await core.consumer_groups.lookup(c.req.param("id"));
    const groupId = String(group.id);
    const members = await core.groupMembers.list(groupId);
    const consumers = await Promise.all(
      members.map((m) => core.consumers.get(String(m.consumer_id))),
    );
    const plugins = await core.plugins.list({
      where: { consumer_group_id: groupId },
      size: ADMIN_PAGE.maxSize,
    });
    return c.json({
      consumer_group: kongRow(group),
      consumers: consumers.map(kongRow),
      plugins: plugins.data.map((p) => shown(c, "plugins", kongPlugin(p))),
    });
  });

  // A target by id or by its `host:port`, within its upstream (Kong's lookup).
  app.get("/upstreams/:parent/targets/:target", async (c) => {
    const core = c.get("adminCore");
    const upstream = await (COLLECTIONS.upstreams as Collection).lookup(
      core,
      c.req.param("parent"),
    );
    const wanted = c.req.param("target");
    const { data } = await core.targets.list({
      where: { upstream_id: String(upstream.id) },
      size: ADMIN_PAGE.maxSize,
    });
    const target = data.find((t) => t.id === wanted || t.target === wanted);
    if (!target) fail(ERR.ADMIN_NOT_FOUND);
    return c.json(kongRow(target));
  });

  registerWrites(app);

  for (const [name, collection] of Object.entries(COLLECTIONS)) {
    app.get(`/${name}`, (c) => page(c, name, collection, listOptions(c)));
    app.get(`/${name}/:id`, async (c) => {
      const row = await collection.lookup(
        c.get("adminCore"),
        c.req.param("id"),
      );
      return c.json(shown(c, name, (collection.serialize ?? kongRow)(row)));
    });
  }

  // Kong's 404 for everything else (e.g. `/consumers/{c}/hmac-auth`, whose
  // plugin Edgway doesn't have), in its JSON shape: decK parses the body.
  app.all("*", () => fail(ERR.ADMIN_NOT_FOUND));

  return app;
}

export { ENTITY_TABLES, entitySchema, pluginSchema } from "./schemas.js";
export { kongPlugin, kongRow } from "./serialize.js";
