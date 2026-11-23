/**
 * The control-plane Worker: the native admin API at `/api/v1` (OpenAPI
 * document and Scalar reference included), behind Cloudflare Access.
 */
import { createAdminCore } from "@edgway/admin-core";
import { ADMIN, ADMIN_UI, SECURITY_HEADERS } from "@edgway/constants";
import { ERR, errorHandler, fail } from "@edgway/errors";
import { i18nMiddleware } from "@edgway/i18n";
import { requestIdMiddleware } from "@edgway/telemetry";
import { Scalar } from "@scalar/hono-api-reference";
import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { adminApi } from "./api";
import type { ConsoleEnv } from "./console";
import { adminCsrf } from "./csrf";
import { adminIdentity, type IdentityEnv } from "./identity";
import { type KongEnv, kongMount } from "./kong";
import { OPENAPI_DOCUMENT } from "./openapi";
import { PLUGINS } from "./plugins";
import type { PortalPublishEnv } from "./portal-publish";
import { API_BASE } from "./roles";

// The ConfigVersion Durable Object gateways read the live version from.
export { ConfigVersion } from "@edgway/adapters-cf";
// Developer-portal publishing and the gateway's read-only version.
export {
  ConfigVersionReader,
  PortalPublish,
  PortalPublisher,
} from "./portal-publish";

export interface Env
  extends IdentityEnv,
    PortalPublishEnv,
    KongEnv,
    ConsoleEnv {
  /** The admin UI's static assets (apps/ui), under /ui/. */
  ASSETS?: Fetcher;
}

const api = adminApi();
api.doc31("/openapi.json", OPENAPI_DOCUMENT);
api.get("/docs", Scalar({ url: `${API_BASE}/openapi.json` }));

const app = new Hono<{ Bindings: Env }>();
app.use("*", requestIdMiddleware());
app.use("*", i18nMiddleware());
// Before identity: a cross-site form post never reaches the API.
app.use("*", adminCsrf());
app.use(`${API_BASE}/*`, adminIdentity());
app.use(`${API_BASE}/*`, async (c, next) => {
  c.set(
    "adminCore",
    createAdminCore(c.env.DB, {
      plugins: PLUGINS,
      workspaceId: c.env.WORKSPACE_ID || ADMIN.defaultWorkspaceId,
      actor: c.get("adminPrincipal").id,
      requestId: c.get("requestId"),
    }),
  );
  await next();
});
app.route(API_BASE, api);
// A path under the native API that no route matches is a 404 here, not the
// Kong mount's token check.
app.all(`${API_BASE}/*`, () => fail(ERR.ADMIN_NOT_FOUND));
// The admin UI: the Worker runs first for /ui (wrangler.jsonc), so every
// response carries the security headers. Asset files come from
// ASSETS; any other /ui path is a client-side route, answered with the SPA's
// index.html. A missing file (a path with an extension) is a 404, not the
// page.
const UI = ADMIN_UI.basePath;
const uiHeaders = secureHeaders({
  // hono takes mutable arrays.
  contentSecurityPolicy: Object.fromEntries(
    Object.entries(SECURITY_HEADERS.adminUiCsp).map(([name, values]) => [
      name,
      [...values],
    ]),
  ),
  referrerPolicy: SECURITY_HEADERS.referrerPolicy,
  xContentTypeOptions: SECURITY_HEADERS.contentTypeOptions,
  xFrameOptions: SECURITY_HEADERS.frameOptions,
});
// `/ui/*` matches `/ui` too.
app.use(`${UI}/*`, uiHeaders);
app.get(UI, (c) => c.redirect(`${UI}/`));
app.get(`${UI}/*`, async (c) => {
  if (!c.env.ASSETS) return c.notFound();
  const file = /\.[a-z0-9]+$/i.test(c.req.path);
  const res = await c.env.ASSETS.fetch(
    file ? c.req.raw : new URL(`${UI}/`, c.req.url),
  );
  // The headers are set on the response, which ASSETS returns immutable.
  return new Response(res.body, res);
});
// Everything else is the Kong-compatible mount (decK, Terraform).
app.route("/", kongMount());
app.onError(errorHandler());

export default app;
