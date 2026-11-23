/**
 * Assembles the data plane: Kong routes matched by the compiled router, each
 * running its plugin phases (@edgway/core runner) in front of the upstream.
 */
import { HTTPS_REDIRECT } from "@edgway/constants";
import { ERR, errorHandler, fail } from "@edgway/errors";
import { type Context, Hono, type MiddlewareHandler } from "hono";
import type { RedirectStatusCode } from "hono/utils/http-status";
import { rewritePhase, routePhases } from "../runner/runner.js";
import type { PluginInstance, RunnerOptions } from "../runner/types.js";
import { compileRouter, type SkippedRoute } from "./compile.js";
import type { KongRoute, KongService, RouteMatch } from "./types.js";

declare module "hono" {
  interface ContextVariableMap {
    edgwayRoute?: RouteMatch;
  }
}

/** The route this request matched (set before the plugin phases run). */
export function getRoute(c: Context): RouteMatch | undefined {
  return c.get("edgwayRoute");
}

export interface GatewayConfig {
  routes: readonly KongRoute[];
  services: readonly KongService[];
  plugins: readonly PluginInstance[];
  /** Sends the matched request upstream (the Upstream adapter). */
  upstream: (c: Context, match: RouteMatch) => Promise<Response>;
}

export function buildGateway(
  config: GatewayConfig,
  options: RunnerOptions = {},
): { app: Hono; skipped: SkippedRoute[] } {
  const router = compileRouter(config.routes, config.services);
  const phases = new Map<string, MiddlewareHandler>(
    config.routes.map((route) => [
      route.id,
      routePhases(
        {
          route: route.id,
          service: route.service_id ?? undefined,
          plugins: config.plugins,
        },
        options,
      ),
    ]),
  );

  const app = new Hono();
  app.onError(errorHandler());
  app.use(rewritePhase(config.plugins, options));
  app.all("*", async (c) => {
    const match = router.match(c.req.raw);
    const run = match && phases.get(match.route.id);
    if (!match || !run) {
      fail(ERR.ROUTE_NOT_FOUND, {
        extensions: { method: c.req.method, path: c.req.path },
      });
    }
    // Kong: a route that accepts HTTPS but not HTTP refuses plain HTTP
    // before any of its plugins run: a redirect to the HTTPS URL when its
    // https_redirect_status_code is a redirect, else 426.
    const { protocols, https_redirect_status_code: redirect } = match.route;
    const url = new URL(c.req.url);
    if (
      protocols?.includes("https") &&
      !protocols.includes("http") &&
      url.protocol === "http:"
    ) {
      if (redirect && HTTPS_REDIRECT.statuses.includes(redirect)) {
        // Kong's Location: https:// + the host (no port) + the request URI.
        url.protocol = "https:";
        url.port = "";
        return c.redirect(url.href, redirect as RedirectStatusCode);
      }
      fail(ERR.ROUTE_HTTPS_REQUIRED);
    }
    c.set("edgwayRoute", match);
    await run(c, async () => {
      c.res = await config.upstream(c, match);
    });
    return c.res;
  });
  return { app, skipped: router.skipped };
}
