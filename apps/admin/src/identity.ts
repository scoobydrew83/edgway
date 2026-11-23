/**
 * Admin identity: Cloudflare Access (@hono/cloudflare-access verifies the
 * Access JWT), then the principal's role from `ADMIN_ROLES`, a public JSON map
 * of Access identities (an email, or a service token's client id) to roles.
 * Fails closed: without a team and AUD, or with a malformed role map, every
 * request is refused.
 */
import type { AdminPrincipal } from "@edgway/core";
import { ERR, fail } from "@edgway/errors";
import { cloudflareAccess } from "@hono/cloudflare-access";
import type { Context, MiddlewareHandler } from "hono";
import { z } from "zod";
import { type AdminRole, ROLES } from "./roles";

export interface IdentityEnv {
  /** The Access team (`<team>.cloudflareaccess.com`). */
  ACCESS_TEAM: string;
  /** The Access application's AUD tag. */
  ACCESS_AUD: string;
  /** JSON: `{ "<email or service-token client id>": "<role>" }`. */
  ADMIN_ROLES: string;
}

declare module "hono" {
  interface ContextVariableMap {
    adminPrincipal: AdminPrincipal;
  }
}

const rank = (role: string) => ROLES.indexOf(role as AdminRole);

const roleMap = z.record(z.string(), z.enum(ROLES));

/** The role map, parsed once per value; undefined when malformed. */
const parsedRoles = new Map<string, Record<string, AdminRole> | undefined>();
function rolesOf(raw: string) {
  if (!parsedRoles.has(raw)) {
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      value = undefined;
    }
    const result = roleMap.safeParse(value);
    parsedRoles.set(raw, result.success ? result.data : undefined);
  }
  return parsedRoles.get(raw);
}

/** Access verifiers, one per team and AUD. */
const verifiers = new Map<string, MiddlewareHandler>();

/** Access, then the principal's role; 401 without a valid Access sign-in, 403 without a role. */
export function adminIdentity(): MiddlewareHandler<{ Bindings: IdentityEnv }> {
  return async (c, next) => {
    const { ACCESS_TEAM: team, ACCESS_AUD: aud } = c.env;
    // An empty AUD would make the library skip the audience check.
    if (!team || !aud) fail(ERR.ADMIN_UNAUTHENTICATED);
    const key = JSON.stringify([team, aud]);
    let access = verifiers.get(key);
    if (!access) {
      try {
        access = cloudflareAccess(team, aud);
      } catch {
        // An invalid team name: refuse rather than answer 500.
        fail(ERR.ADMIN_UNAUTHENTICATED);
      }
      verifiers.set(key, access);
    }
    // Access answers a missing or invalid token itself (plain text 401).
    const denied = await access(c, async () => {
      const payload = c.get("accessPayload") as {
        email?: string;
        common_name?: string;
        sub?: string;
      };
      const id = payload.email ?? payload.common_name ?? payload.sub ?? "";
      const role = rolesOf(c.env.ADMIN_ROLES || "{}")?.[id];
      // The detail names what to fix, as ADMIN_PUBLISH_DISABLED does.
      if (!role) fail(ERR.ADMIN_FORBIDDEN, { detail: "ADMIN_ROLES" });
      c.set("adminPrincipal", { id, email: payload.email, roles: [role] });
      await next();
    });
    if (denied instanceof Response) fail(ERR.ADMIN_UNAUTHENTICATED);
  };
}

/** Whether the caller holds at least `role`. */
export const holds = (c: Context, role: AdminRole) =>
  (c.get("adminPrincipal")?.roles ?? []).some((r) => rank(r) >= rank(role));

/** Route middleware: at least `role` (viewer < editor < publisher < owner). */
export function requireRole(role: AdminRole): MiddlewareHandler {
  return async (c, next) => {
    if (!holds(c, role)) fail(ERR.ADMIN_ROLE_REQUIRED);
    await next();
  };
}
