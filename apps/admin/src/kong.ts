/**
 * The Kong-compatible mount (@edgway/kong-compat) for decK and Terraform. It
 * authenticates `Kong-Admin-Token` against the `KONG_ADMIN_TOKENS` secret, a
 * JSON map of sha256(token) to role, and fails closed. The native API stays
 * behind Cloudflare Access; this mount's path gets an Access bypass or
 * service-token policy in production. Reads need any role, writes editor,
 * and `POST /edgway/publish` (for CI after `deck gateway sync`) publisher.
 */
import { createAdminCore } from "@edgway/admin-core";
import { ADMIN, HEADER, KONG_COMPAT } from "@edgway/constants";
import { sha256Hex } from "@edgway/core";
import { ERR, errorHandler, fail, STATUS } from "@edgway/errors";
import { kongAdminApi } from "@edgway/kong-compat";
import { Hono } from "hono";
import { z } from "zod";
import { holds, requireRole } from "./identity";
import { PLUGINS } from "./plugins";
import { type PublishEnv, publishTarget } from "./publish";
import { KONG_PUBLISH_PATH, ROLES } from "./roles";

export interface KongEnv extends PublishEnv {
  DB: D1Database;
  WORKSPACE_ID?: string;
  /** Secret: `{ "<sha256 of token>": "<role>" }`. */
  KONG_ADMIN_TOKENS?: string;
}

/** Methods that only read; every other one writes. */
const READS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Kong's schema validation writes nothing, so any role may ask:
 * exactly `POST /schemas/<entity>/validate`, on `/` or the default
 * workspace. Nested write paths can end the same way
 * (`/services/schemas/routes/validate`), so the whole path must match.
 */
const VALIDATES = new RegExp(
  `^(?:/${KONG_COMPAT.defaultWorkspace})?/schemas/[^/]+/validate$`,
);
const validates = (method: string, path: string) =>
  method === "POST" && VALIDATES.test(path);

const tokenMap = z.record(z.string(), z.enum(ROLES));
const parsed = new Map<
  string,
  Record<string, (typeof ROLES)[number]> | undefined
>();

function tokensOf(raw: string) {
  if (!parsed.has(raw)) {
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      value = undefined;
    }
    const result = tokenMap.safeParse(value);
    parsed.set(raw, result.success ? result.data : undefined);
  }
  return parsed.get(raw);
}

export function kongMount() {
  const kong = new Hono<{ Bindings: KongEnv }>();
  kong.use("*", async (c, next) => {
    const token = c.req.header(HEADER.kongAdminToken);
    const tokens = tokensOf(c.env.KONG_ADMIN_TOKENS ?? "");
    if (!token || !tokens) fail(ERR.ADMIN_UNAUTHENTICATED);
    const hash = await sha256Hex(token);
    const role = tokens[hash];
    if (!role) fail(ERR.ADMIN_UNAUTHENTICATED);
    // The token's hash prefix names it in the audit log, never the token.
    const actor = `kong-admin-token:${hash.slice(0, 12)}`;
    c.set("adminPrincipal", { id: actor, roles: [role] });
    // Viewer tokens read secrets masked.
    c.set("kongRedactSecrets", !holds(c, "editor"));
    c.set(
      "adminCore",
      createAdminCore(c.env.DB, {
        plugins: PLUGINS,
        workspaceId: c.env.WORKSPACE_ID || ADMIN.defaultWorkspaceId,
        actor,
        requestId: c.get("requestId"),
      }),
    );
    await next();
  });
  const editor = requireRole("editor");
  kong.use("*", (c, next) =>
    READS.has(c.req.method) || validates(c.req.method, c.req.path)
      ? next()
      : editor(c, next),
  );
  kong.post(KONG_PUBLISH_PATH, requireRole("publisher"), async (c) =>
    c.json(
      await c.get("adminCore").config.publish(await publishTarget(c)),
      STATUS.created,
    ),
  );
  kong.route("/", kongAdminApi());
  // Kong's own error shape, {"message": ...}, for decK and Terraform.
  kong.onError(errorHandler({ format: "kong" }));
  return kong;
}
