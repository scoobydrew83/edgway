/**
 * Kong's schema validation endpoints: `POST /schemas/{entity}/validate`
 * and `POST /schemas/plugins/validate`, which decK's `gateway validate`
 * calls for every entity in a file. Only the schema is checked, as in Kong:
 * nothing is written and references aren't looked up. A valid entity gets
 * Kong's 200; an invalid one Kong's 400 schema violation, with its `fields`.
 */
import { type AdminCore, isVaultReference, type Row } from "@edgway/admin-core";
import { KONG_COMPAT } from "@edgway/constants";
import { ERR } from "@edgway/errors";
import {
  kongValidatePluginNotEnabled,
  kongValidateUnknownEntity,
  kongValidateVaultOnly,
  kongValidateViolations,
  t,
} from "@edgway/i18n";
import { type EntityName, entitySchemas } from "@edgway/schema";
import type { Context } from "hono";
import { z } from "zod";
import { dropNulls, MANAGED, REFERENCES, serviceUrl } from "./writes.js";

/** One violation: where (dotted), and what's wrong. */
type Violation = { path: string; message: string };

/** Kong's DAO names (what decK sends) → Edgway's entity. */
const ENTITIES: Record<string, EntityName> = {
  services: "services",
  routes: "routes",
  upstreams: "upstreams",
  targets: "targets",
  consumers: "consumers",
  consumer_groups: "consumer_groups",
  certificates: "certificates",
  ca_certificates: "ca_certificates",
  snis: "snis",
  vaults: "vaults",
  jwt_secrets: "jwt_secrets",
  acls: "acls",
  keyauth_credentials: "keyauth_credentials",
  basicauth_credentials: "basicauth_credentials",
};

/**
 * Credentials stored hashed: their rows hold the hash, so the request's own
 * fields are checked instead (Kong's key and password are strings).
 */
const CREDENTIALS: Partial<Record<EntityName, z.ZodType>> = {
  keyauth_credentials: z.looseObject({
    key: z.string().min(1).optional(),
    ttl: z.number().int().nullish(),
    tags: z.array(z.string()).nullish(),
  }),
  basicauth_credentials: z.looseObject({
    username: z.string().min(1),
    password: z.string().min(1),
    tags: z.array(z.string()).nullish(),
  }),
};

/** Secret fields Edgway takes only as vault references. */
const VAULT_ONLY: Partial<Record<EntityName, string[]>> = {
  jwt_secrets: ["secret"],
  certificates: ["key", "key_alt"],
};

const issues = (error: z.ZodError | undefined): Violation[] =>
  (error?.issues ?? []).map((i) => ({
    path: i.path.map(String).join("."),
    message: i.message,
  }));

/** A Kong body as a row: references become ids, never looked up. */
function asRow(entity: EntityName, input: Row): Row {
  const row: Row = {};
  for (const [key, value] of Object.entries(input)) {
    if (MANAGED.has(key)) continue;
    const reference = REFERENCES[key];
    if (reference) {
      const id = (value as { id?: unknown } | null)?.id;
      row[reference[1]] =
        typeof id === "string" ? id : KONG_COMPAT.validationReferenceId;
    } else if (key === "url" && entity === "services") {
      Object.assign(row, serviceUrl(value));
    } else {
      row[key] = value;
    }
  }
  return row;
}

/** What's wrong with an entity, by Edgway's schema for it. */
function entityViolations(entity: EntityName, input: Row): Violation[] {
  const credential = CREDENTIALS[entity];
  if (credential) return issues(credential.safeParse(input).error);
  const row = asRow(entity, input);
  const found = issues(
    entitySchemas[entity].insert.safeParse({
      ...row,
      id: row.id ?? KONG_COMPAT.validationReferenceId,
      workspace_id: KONG_COMPAT.validationReferenceId,
    }).error,
  ).filter((v) => v.path !== "workspace_id");
  for (const field of VAULT_ONLY[entity] ?? []) {
    const value = row[field];
    if (value !== null && value !== undefined && !isVaultReference(value)) {
      found.push({ path: field, message: t(kongValidateVaultOnly) });
    }
  }
  return found;
}

/** What's wrong with a plugin: not bundled, or a config its schema refuses. */
function pluginViolations(core: AdminCore, input: Row): Violation[] {
  const name = String(input.name ?? "");
  const plugin = core.catalog.get(name);
  if (!plugin) {
    return [
      { path: "name", message: t(kongValidatePluginNotEnabled, { name }) },
    ];
  }
  const result = plugin.config.safeParse({
    config: dropNulls(input.config ?? {}),
  });
  return result.success ? [] : issues(result.error as z.ZodError | undefined);
}

/**
 * Kong's nested `fields` object from dotted paths. Entity-level errors go in
 * `@entity` as a list, as Kong's do; an error under a field that already has
 * one nests beside it rather than replacing it. Nodes have no prototype, so a
 * path segment such as `__proto__` is an ordinary key.
 */
export function fieldsOf(violations: Violation[]): Row {
  const node = (): Row => Object.create(null);
  const fields = node();
  for (const { path, message } of violations) {
    if (!path) {
      const entity = (fields["@entity"] as string[] | undefined) ?? [];
      fields["@entity"] = [...entity, message];
      continue;
    }
    const keys = path.split(".");
    let at = fields;
    for (const key of keys.slice(0, -1)) {
      const child = at[key];
      if (!child || typeof child !== "object" || Array.isArray(child)) {
        at[key] = node();
        if (typeof child === "string") (at[key] as Row)["@entity"] = [child];
      }
      at = at[key] as Row;
    }
    at[keys[keys.length - 1] as string] = message;
  }
  return fields;
}

/** Kong's answer: 200 when valid, else its 400 schema violation. */
function answer(c: Context, violations: Violation[]) {
  if (violations.length === 0) {
    return c.json({ message: KONG_COMPAT.validation.ok });
  }
  return c.json(
    {
      code: KONG_COMPAT.validation.violationCode,
      name: KONG_COMPAT.validation.violation,
      message: t(kongValidateViolations, {
        count: violations.length,
        details: violations
          .map((v) => `${v.path || "@entity"}: ${v.message}`)
          .join("; "),
      }),
      fields: fieldsOf(violations),
    },
    ERR.ADMIN_INVALID_REQUEST.status,
  );
}

const body = async (c: Context): Promise<Row | undefined> => {
  const value: unknown = await c.req.json().catch(() => undefined);
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Row)
    : undefined;
};

/** `POST /schemas/plugins/validate`. */
export async function validatePlugin(c: Context) {
  // A missing body validates as empty, so the schema names what's missing.
  const input = (await body(c)) ?? {};
  return answer(c, pluginViolations(c.get("adminCore"), input));
}

/** `POST /schemas/{entity}/validate`: 404 for an entity Edgway doesn't have. */
export async function validateEntity(c: Context) {
  const name = c.req.param("entity") ?? "";
  const entity = ENTITIES[name];
  if (!entity) {
    return c.json(
      { message: t(kongValidateUnknownEntity, { name }) },
      ERR.ADMIN_NOT_FOUND.status,
    );
  }
  return answer(c, entityViolations(entity, (await body(c)) ?? {}));
}
