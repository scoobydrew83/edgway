/**
 * Kong's rate-limiting (priority 910) on hono-rate-limiter: one limiter per
 * configured window (second to year), each over the `RateLimitStore` the
 * gateway supplies for that window and policy (the Cloudflare Rate Limiting
 * binding for `local` second/minute windows, the Durable Object counter
 * otherwise). This file maps Kong's config onto it: the client identifier
 * (`limit_by`), counters scoped to the matched route and service with the
 * identifier hashed, Kong's response headers, `error_code`/`error_message`,
 * `hide_client_headers` and `fault_tolerant`.
 */
import { HEADER, RATE_LIMIT_WINDOW_MS } from "@edgway/constants";
import {
  getConsumer,
  getRoute,
  type RateLimitStore,
  sha256Hex,
} from "@edgway/core";
import { ERR, fail, problemResponse } from "@edgway/errors";
import { definePlugin, type PluginConfig } from "@edgway/plugin-sdk";
import { kongSchema } from "@edgway/schema";
import type { Context, MiddlewareHandler, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { rateLimiter } from "hono-rate-limiter";

/** Kong's windows, shortest first. */
const WINDOWS = ["second", "minute", "hour", "day", "month", "year"] as const;
export type RateLimitWindow = (typeof WINDOWS)[number];
/** Kong's `policy`; `redis` is served by the cluster store. */
export type RateLimitPolicy = "local" | "cluster";

/** A counter store; `exact: false` means its counts are approximate. */
export type WindowStore = RateLimitStore & { exact?: boolean };

/**
 * Where rate-limiting finds its counters (supplied by the gateway). Keys carry
 * the window, but a store that takes its window length from `init(windowMs)`
 * (hono-rate-limiter's contract, e.g. `MemoryStore`) must be one object per
 * window; the Durable Object and binding stores know their window themselves.
 */
export interface RateLimitStores {
  store(window: RateLimitWindow, policy: RateLimitPolicy): WindowStore;
}

declare module "hono" {
  interface ContextVariableMap {
    edgwayRateLimitStores?: RateLimitStores;
    /** This request's counter key (hashed identifier, scoped to route and service). */
    edgwayRateLimitKey?: string;
    /** Set when any window is exceeded. */
    edgwayRateLimitExceeded?: boolean;
  }
}

/** Called by the gateway before the plugins run. */
export function setRateLimitStores(c: Context, stores: RateLimitStores): void {
  c.set("edgwayRateLimitStores", stores);
}

const schema = kongSchema("rate-limiting");
type Config = PluginConfig<typeof schema>;

interface Usage {
  window: RateLimitWindow;
  limit: number;
  remaining: number;
  /** Seconds until the window resets, when the store knows it. */
  reset?: number;
  exact: boolean;
}

const MS_PER_SECOND = 1000;

/** Where hono-rate-limiter leaves one window's usage on the context. */
const infoProperty = (window: RateLimitWindow) => `edgwayRateLimit:${window}`;

/** Kong's client identifier, falling back to the client IP. */
function identifier(c: Context, config: Config): string {
  const consumer = getConsumer(c);
  const byLimit: Partial<Record<string, string | undefined>> = {
    consumer: consumer?.id,
    // Only an auth plugin sets the credential header (clients' copies are removed).
    credential: consumer
      ? c.req.header(HEADER.credentialIdentifier)
      : undefined,
    service: getRoute(c)?.service?.id,
    header: config.header_name ? c.req.header(config.header_name) : undefined,
    path: config.path && c.req.path === config.path ? c.req.path : undefined,
  };
  return byLimit[config.limit_by ?? ""] ?? c.req.header(HEADER.clientIp) ?? "";
}

/** Kong's headers: per window, then the tightest window as `RateLimit-*`. */
function usageHeaders(usage: readonly Usage[]): Record<string, string> {
  const headers: Record<string, string> = {};
  let tightest: Usage | undefined;
  for (const u of usage) {
    headers[`${HEADER.rateLimitLimit}-${u.window}`] = String(u.limit);
    if (u.exact) {
      headers[`${HEADER.rateLimitRemaining}-${u.window}`] = String(u.remaining);
    }
    // Fewest remaining wins; on a tie, the longer window (later in WINDOWS).
    if (!tightest || u.remaining <= tightest.remaining) tightest = u;
  }
  if (tightest) {
    headers[HEADER.rateLimitStandardLimit] = String(tightest.limit);
    if (tightest.exact) {
      headers[HEADER.rateLimitStandardRemaining] = String(tightest.remaining);
    }
    if (tightest.reset !== undefined) {
      headers[HEADER.rateLimitStandardReset] = String(tightest.reset);
    }
  }
  return headers;
}

export default definePlugin({
  name: "rate-limiting",
  version: "1.0.0",
  priority: 910,
  config: schema,
  enforces: "rate-limit",
  access: (config) => {
    const windows = WINDOWS.filter(
      (window) => typeof config[window] === "number",
    );
    const policy: RateLimitPolicy =
      config.policy === "local" ? "local" : "cluster";
    const status = (config.error_code ??
      ERR.RATE_LIMITED.status) as ContentfulStatusCode;

    // One limiter per store and window: hono-rate-limiter initializes its
    // store when a limiter is created, so limiters are built once, not per request.
    const limiters = new WeakMap<
      WindowStore,
      Map<RateLimitWindow, MiddlewareHandler>
    >();
    const limiterFor = (window: RateLimitWindow, store: WindowStore) => {
      let byWindow = limiters.get(store);
      if (!byWindow) {
        byWindow = new Map();
        limiters.set(store, byWindow);
      }
      let limiter = byWindow.get(window);
      if (!limiter) {
        limiter = rateLimiter({
          limit: config[window] as number,
          // Stores that count by duration (hono-rate-limiter's contract) read it here.
          windowMs: RATE_LIMIT_WINDOW_MS[window],
          store,
          // The window is part of the key, so one store may serve every window.
          keyGenerator: (c) => `${window}:${c.get("edgwayRateLimitKey") ?? ""}`,
          requestPropertyName: infoProperty(window),
          standardHeaders: false,
          // Keep counting the other windows; the request stops after all of them.
          handler: (c, nextWindow) => {
            c.set("edgwayRateLimitExceeded", true);
            return nextWindow();
          },
        });
        byWindow.set(window, limiter);
      }
      return limiter;
    };

    return async (c: Context, next: Next) => {
      if (windows.length === 0) fail(ERR.INTERNAL);
      const stores = c.get("edgwayRateLimitStores");
      if (!stores) fail(ERR.INTERNAL);

      const route = getRoute(c);
      const key = await sha256Hex(
        JSON.stringify([
          route?.route.id,
          route?.service?.id,
          config.limit_by,
          identifier(c, config),
        ]),
      );
      c.set("edgwayRateLimitKey", key);
      c.set("edgwayRateLimitExceeded", false);

      const usage: Usage[] = [];
      let upstreamReached = false;
      let blocked: Response | undefined;
      const chain = windows.map((window) =>
        limiterFor(window, stores.store(window, policy)),
      );

      const afterAll = async () => {
        const now = Date.now();
        for (const window of windows) {
          const info = c.get(infoProperty(window) as never) as {
            limit: number;
            remaining: number;
            resetTime?: Date;
          };
          const store = stores.store(window, policy);
          usage.push({
            window,
            limit: info.limit,
            remaining: info.remaining,
            reset: info.resetTime
              ? Math.max(
                  1,
                  Math.ceil((info.resetTime.getTime() - now) / MS_PER_SECOND),
                )
              : undefined,
            exact: store.exact !== false,
          });
        }
        const headers = config.hide_client_headers ? {} : usageHeaders(usage);
        if (c.get("edgwayRateLimitExceeded")) {
          const res = problemResponse(
            { ...ERR.RATE_LIMITED, status },
            { detail: config.error_message ?? undefined },
          );
          for (const [name, value] of Object.entries(headers)) {
            res.headers.set(name, value);
          }
          const reset = headers[HEADER.rateLimitStandardReset];
          if (reset) res.headers.set(HEADER.retryAfter, reset);
          // Raised after the limiter chain returns: a rejection passed back
          // through hono-rate-limiter's handler is reported as unhandled.
          blocked = res;
          return;
        }
        upstreamReached = true;
        await next();
        for (const [name, value] of Object.entries(headers)) {
          c.res.headers.set(name, value);
        }
      };

      const run = (i: number): Promise<void> =>
        i === chain.length
          ? afterAll()
          : (chain[i] as MiddlewareHandler)(c, () => run(i + 1)).then(
              () => undefined,
            );

      try {
        await run(0);
      } catch (error) {
        if (upstreamReached) throw error;
        // A counter store failed: Kong's fault_tolerant lets the request through.
        if (!config.fault_tolerant) throw error;
        await next();
        return;
      }
      if (blocked) throw new HTTPException(status, { res: blocked });
    };
  },
});
