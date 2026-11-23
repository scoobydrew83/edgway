/**
 * Applies a decK file through the Kong-compatible API (@edgway/kong-compat),
 * entity by entity in dependency order, the way `deck gateway sync` would.
 * Entities with an id or a unique name are upserted (PUT), so importing the
 * same file twice changes nothing; the rest are created. One refused entity
 * doesn't stop the others: every refusal is reported.
 */
import { ERR } from "@edgway/errors";

export type Row = Record<string, unknown>;

/** One Kong Admin API call: method, path, JSON body → status and JSON body. */
export type Send = (
  method: string,
  path: string,
  body?: unknown,
) => Promise<{ status: number; body: Row }>;

interface Failure {
  entity: string;
  name: string;
  message: string;
}

export interface Outcome {
  imported: number;
  failures: Failure[];
}

const list = (value: unknown): Row[] =>
  Array.isArray(value) ? (value as Row[]) : [];

const omit = (row: Row, keys: string[]): Row =>
  Object.fromEntries(Object.entries(row).filter(([k]) => !keys.includes(k)));

/** A decK reference (a name, an id, or `{ id }`/`{ name }`) for the Kong API. */
const reference = (value: unknown, field = "name") =>
  typeof value === "string" ? { [field]: value } : value;

/** Kong's plugin scope fields and the collection each names. */
const SCOPES = {
  service: "name",
  route: "name",
  consumer: "username",
  consumer_group: "name",
} as const;

/** Credentials nested in a decK consumer → the Kong path segment and its unique field. */
const CREDENTIALS: [string, string, string | undefined][] = [
  ["keyauth_credentials", "key-auth", undefined],
  ["basicauth_credentials", "basic-auth", "username"],
  ["jwt_secrets", "jwt", "key"],
  ["acls", "acls", undefined],
  ["hmacauth_credentials", "hmac-auth", "username"],
  ["mtls_auth_credentials", "mtls-auth", undefined],
  ["oauth2_credentials", "oauth2", undefined],
];

const CONFLICT = ERR.ADMIN_CONFLICT.status;

export async function applyDeck(file: Row, send: Send): Promise<Outcome> {
  const outcome: Outcome = { imported: 0, failures: [] };

  const refused = (entity: string, name: string, body: Row) =>
    outcome.failures.push({
      entity,
      name,
      message: String(body.message ?? body.title ?? ""),
    });

  /** Upsert by id or unique field (PUT), else create (POST). */
  async function put(
    entity: string,
    base: string,
    row: Row,
    field?: string,
    { conflictIsDone = false } = {},
  ): Promise<Row | undefined> {
    const key = (row.id ?? (field ? row[field] : undefined)) as
      | string
      | undefined;
    const res = key
      ? await send("PUT", `${base}/${encodeURIComponent(key)}`, row)
      : await send("POST", base, row);
    if (res.status < 300 || (conflictIsDone && res.status === CONFLICT)) {
      outcome.imported += 1;
      return res.body;
    }
    refused(entity, key ?? String(row.name ?? row.username ?? ""), res.body);
    return undefined;
  }

  /**
   * A plugin: by id when it has one, else the existing plugin with the same
   * name (and instance name) on the same scope is replaced, else created.
   */
  async function plugin(base: string, row: Row, scope: Row) {
    if (row.id) return put("plugin", base, row);
    const { status, body } = await send("GET", base);
    const existing =
      status < 300
        ? list(body.data).find(
            (p) =>
              p.name === row.name &&
              (p.instance_name ?? null) === (row.instance_name ?? null) &&
              Object.keys(SCOPES).every(
                (k) =>
                  ((p[k] as Row | null)?.id ?? null) ===
                  ((scope[k] as Row | undefined)?.id ?? null),
              ),
          )
        : undefined;
    return put("plugin", base, existing ? { ...row, id: existing.id } : row);
  }

  /** Top-level references (names or ids) → `{ id }`, for scope matching. */
  async function resolve(row: Row): Promise<Row> {
    const scope: Row = {};
    for (const [k, field] of Object.entries(SCOPES)) {
      const value = row[k];
      if (value === undefined || value === null) continue;
      const ref = reference(value, field) as Row;
      const key = String(ref.id ?? ref[field]);
      const { status, body } = await send(
        "GET",
        `/${k}s/${encodeURIComponent(key)}`,
      );
      scope[k] = status < 300 ? { id: body.id } : ref;
    }
    return scope;
  }

  for (const ca of list(file.ca_certificates)) {
    await put("ca_certificate", "/ca_certificates", ca);
  }
  for (const cert of list(file.certificates)) {
    const created = await put(
      "certificate",
      "/certificates",
      omit(cert, ["snis"]),
    );
    if (!created) continue;
    for (const sni of list(cert.snis)) {
      await put(
        "sni",
        "/snis",
        { ...sni, certificate: { id: created.id } },
        "name",
      );
    }
  }
  for (const vault of list(file.vaults)) {
    await put("vault", "/vaults", vault, "prefix");
  }

  async function routeWithPlugins(base: string, route: Row) {
    const created = await put("route", base, omit(route, ["plugins"]), "name");
    if (!created) return;
    for (const p of list(route.plugins)) {
      await plugin(`/routes/${created.id}/plugins`, p, {
        route: { id: created.id },
      });
    }
  }

  for (const service of list(file.services)) {
    const created = await put(
      "service",
      "/services",
      omit(service, ["routes", "plugins"]),
      "name",
    );
    if (!created) continue;
    for (const route of list(service.routes)) {
      await routeWithPlugins(`/services/${created.id}/routes`, route);
    }
    for (const p of list(service.plugins)) {
      await plugin(`/services/${created.id}/plugins`, p, {
        service: { id: created.id },
      });
    }
  }
  for (const route of list(file.routes)) {
    await routeWithPlugins("/routes", {
      ...route,
      ...(route.service === undefined
        ? {}
        : { service: reference(route.service) }),
    });
  }

  for (const upstream of list(file.upstreams)) {
    const created = await put(
      "upstream",
      "/upstreams",
      omit(upstream, ["targets"]),
      "name",
    );
    if (!created) continue;
    for (const target of list(upstream.targets)) {
      await put("target", `/upstreams/${created.id}/targets`, target, "target");
    }
  }

  for (const group of list(file.consumer_groups)) {
    await put(
      "consumer_group",
      "/consumer_groups",
      omit(group, ["consumers", "plugins"]),
      "name",
    );
  }

  async function member(group: string, consumer: string) {
    const res = await send(
      "POST",
      `/consumer_groups/${encodeURIComponent(group)}/consumers`,
      { consumer },
    );
    if (res.status < 300 || res.status === CONFLICT) outcome.imported += 1;
    else refused("consumer_group_consumer", `${group}/${consumer}`, res.body);
  }

  for (const consumer of list(file.consumers)) {
    const created = await put(
      "consumer",
      "/consumers",
      omit(consumer, ["plugins", "groups", ...CREDENTIALS.map(([key]) => key)]),
      "username",
    );
    if (!created) continue;
    const id = String(created.id);
    for (const [key, segment, field] of CREDENTIALS) {
      for (const credential of list(consumer[key])) {
        // A key-auth key already stored (it is hashed) is not an error.
        await put(key, `/consumers/${id}/${segment}`, credential, field, {
          conflictIsDone: segment === "key-auth",
        });
      }
    }
    for (const group of list(consumer.groups)) {
      await member(String(group.id ?? group.name), id);
    }
    for (const p of list(consumer.plugins)) {
      await plugin(`/consumers/${id}/plugins`, p, { consumer: { id } });
    }
  }
  for (const group of list(file.consumer_groups)) {
    for (const c of list(group.consumers)) {
      await member(
        String(group.id ?? group.name),
        String(c.id ?? c.username ?? c.custom_id),
      );
    }
  }

  for (const p of list(file.plugins)) {
    const scope = await resolve(p);
    await plugin("/plugins", { ...p, ...scope }, scope);
  }

  return outcome;
}
