/**
 * CSRF protection for the admin: `hono/csrf` refuses a state-changing
 * request a form could send (`text/plain`, form-encoded, multipart) unless it
 * comes from this origin. It runs only for browsers, which always send
 * `Origin` or `Sec-Fetch-Site` on a cross-site write; decK, Terraform, the CLI
 * and the SDK send neither, and authenticate with tokens a page can't attach.
 */
import { HEADER } from "@edgway/constants";
import { ERR, fail } from "@edgway/errors";
import type { MiddlewareHandler } from "hono";
import { csrf } from "hono/csrf";

export function adminCsrf(): MiddlewareHandler {
  const check = csrf();
  return async (c, next) => {
    const browser =
      c.req.header(HEADER.origin) !== undefined ||
      c.req.header(HEADER.secFetchSite) !== undefined;
    if (browser) {
      // Only the check runs here; the rest of the chain runs below.
      try {
        await check(c, async () => {});
      } catch {
        fail(ERR.ADMIN_FORBIDDEN, { extensions: { reason: "csrf" } });
      }
    }
    await next();
  };
}
