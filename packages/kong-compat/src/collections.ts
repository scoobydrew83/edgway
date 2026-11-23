/**
 * Kong's collections over @edgway/admin-core: how to list, find, create,
 * update and delete each one, and how to serialize its rows.
 */
import type { AdminCore, ListOptions, Page, Row } from "@edgway/admin-core";
import { KONG_HIDDEN_KEY } from "@edgway/constants";
import { ERR, fail } from "@edgway/errors";
import { kongPlugin, kongRow } from "./serialize.js";

/** A Kong collection and the admin-core operations behind it. */
export interface Collection {
  list(core: AdminCore, options: ListOptions): Promise<Page<Row>>;
  lookup(core: AdminCore, idOrName: string): Promise<Row>;
  /** The unique field Kong's `{id or name}` paths also match, if any. */
  field?: string;
  serialize?: (row: Row) => Row;
  create(core: AdminCore, row: Row): Promise<Row>;
  update(core: AdminCore, id: string, row: Row, replace: boolean): Promise<Row>;
  remove(core: AdminCore, id: string): Promise<void>;
}

interface Service {
  list(o: ListOptions): Promise<Page<Row>>;
  get(id: string): Promise<Row>;
  lookup?(id: string, field?: string): Promise<Row>;
  create(row: Row): Promise<Row>;
  update(id: string, row: Row, replace?: boolean): Promise<Row>;
  delete(id: string): Promise<void>;
}

/** An admin-core entity service; `field` makes it findable by that field too. */
function entity(
  pick: (core: AdminCore) => Service,
  field?: string,
): Collection {
  return {
    field,
    list: (core, options) => pick(core).list(options),
    lookup: (core, id) => {
      const service = pick(core);
      return field && service.lookup
        ? service.lookup(id, field)
        : service.get(id);
    },
    create: (core, row) => pick(core).create(row),
    update: (core, id, row, replace) => pick(core).update(id, row, replace),
    remove: (core, id) => pick(core).delete(id),
  };
}

/**
 * key-auth: the key is stored hashed, so reads return a placeholder `key`
 * (decK indexes credentials by key) and an update can change only the key
 * (atomically, through rotate). Kong's PUT without a key issues a new one;
 * PATCH without one, or with the placeholder, keeps it. The raw key is in
 * write responses only.
 */
const hiddenKey = (row: Row) => `${KONG_HIDDEN_KEY.prefix}${row.id}`;
const isHidden = (key: unknown) =>
  typeof key === "string" && key.startsWith(KONG_HIDDEN_KEY.prefix);

const keyAuths: Collection = {
  list: (core, options) => core.keyAuth.list(options),
  lookup: (core, id) => core.keyAuth.get(id),
  serialize: (row) => ({ ...kongRow(row), key: row.key ?? hiddenKey(row) }),
  async create(core, row) {
    if (isHidden(row.key)) {
      fail(ERR.ADMIN_INVALID_REQUEST, { extensions: { field: "key" } });
    }
    const { credential, key } = await core.keyAuth.create(row as never);
    return { ...credential, key };
  },
  async update(core, id, row, replace) {
    const current = await core.keyAuth.get(id);
    for (const field of ["consumer_id", "ttl", "tags"]) {
      const wanted =
        field in row ? row[field] : replace ? null : current[field];
      if (
        JSON.stringify(wanted ?? null) !==
        JSON.stringify(current[field] ?? null)
      ) {
        fail(ERR.ADMIN_INVALID_REQUEST, { extensions: { field } });
      }
    }
    const key = row.key as string | undefined;
    if (isHidden(key) || (key === undefined && !replace)) return current;
    const rotated = await core.keyAuth.rotate(id, key);
    return { ...rotated.credential, key: rotated.key };
  },
  remove: (core, id) => core.keyAuth.delete(id),
};

/** basic-auth: passwords are hashed in Kong's format by admin-core. */
const basicAuths: Collection = {
  field: "username",
  list: (core, options) => core.basicAuth.list(options),
  async lookup(core, id) {
    const { data } = await core.basicAuth.list({ where: { username: id } });
    return data[0] ?? core.basicAuth.get(id);
  },
  create: (core, row) => core.basicAuth.create(row as never),
  update: (core, id, row) => core.basicAuth.update(id, row as never),
  remove: (core, id) => core.basicAuth.delete(id),
};

/** Kong's collection names → admin-core services. */
export const COLLECTIONS: Record<string, Collection> = {
  services: entity((core) => core.services, "name"),
  routes: entity((core) => core.routes, "name"),
  upstreams: entity((core) => core.upstreams, "name"),
  consumer_groups: entity((core) => core.consumer_groups, "name"),
  consumers: entity((core) => core.consumers, "username"),
  snis: entity((core) => core.snis, "name"),
  vaults: entity((core) => core.vaults, "prefix"),
  certificates: entity((core) => core.certificates),
  ca_certificates: entity((core) => core.ca_certificates),
  plugins: {
    ...entity((core) => core.plugins, "instance_name"),
    serialize: kongPlugin,
  },
  "key-auths": keyAuths,
  "basic-auths": basicAuths,
  jwts: entity((core) => core.jwt_secrets, "key"),
  acls: entity((core) => core.acls),
};

/** Targets are reached through their upstream only. */
const TARGETS: Collection = entity((core) => core.targets, "target");

/** Kong collections Edgway has no entities for: always empty. */
export const EMPTY = [
  "key-sets",
  "keys",
  "degraphql_routes",
  "filter-chains",
  "hmac-auths",
  "mtls-auths",
  "oauth2",
  "partials",
];

/** Nested collections: parent collection, path segment, child, reference column. */
export const NESTED: [string, string, string, string][] = [
  ["services", "routes", "routes", "service_id"],
  ["services", "plugins", "plugins", "service_id"],
  ["routes", "plugins", "plugins", "route_id"],
  ["consumers", "plugins", "plugins", "consumer_id"],
  ["consumer_groups", "plugins", "plugins", "consumer_group_id"],
  ["upstreams", "targets", "targets", "upstream_id"],
  ["consumers", "key-auth", "key-auths", "consumer_id"],
  ["consumers", "basic-auth", "basic-auths", "consumer_id"],
  ["consumers", "jwt", "jwts", "consumer_id"],
  ["consumers", "acls", "acls", "consumer_id"],
];

export const collectionOf = (name: string) =>
  (name === "targets" ? TARGETS : COLLECTIONS[name]) as Collection;

/**
 * The row an `{id or name}` path names, or undefined: by id first, then by
 * the collection's unique field, within `where` (a parent's reference).
 */
export async function findOne(
  core: AdminCore,
  collection: Collection,
  idOrName: string,
  where: Record<string, string> = {},
): Promise<Row | undefined> {
  const [byId] = (
    await collection.list(core, { where: { ...where, id: idOrName }, size: 1 })
  ).data;
  if (byId || !collection.field) return byId;
  const [byField] = (
    await collection.list(core, {
      where: { ...where, [collection.field]: idOrName },
      size: 1,
    })
  ).data;
  return byField;
}
