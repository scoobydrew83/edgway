/**
 * Kong's proxy-cache (priority 100) on Edgway's `CacheStore` (Workers Cache
 * behind the adapter). This file maps Kong's cache rules onto it:
 * - which requests and responses are cacheable (methods, status codes,
 *   content types, and RFC 9111 Cache-Control with `cache_control`);
 * - the cache key: method, path (`ignore_uri_case`), the query
 *   (`vary_query_params`), `vary_headers` and the consumer; credentials sent
 *   in the query are left out of the key;
 * - Kong's `X-Cache-Status` (Hit, Miss, Refresh, Bypass), `X-Cache-Key` and
 *   `Age` headers.
 * A cached response is served with the upstream's own Cache-Control; the
 * storage headers the adapter adds (Cache-Control, Cache-Tag) never reach
 * clients.
 */
import { CACHE_DIRECTIVE, HEADER, KONG_CACHE_STATUS } from "@edgway/constants";
import { type CacheStore, getConsumer, getRoute } from "@edgway/core";
import { definePlugin, type PluginConfig } from "@edgway/plugin-sdk";
import { kongSchema } from "@edgway/schema";
import type { Context } from "hono";

/** What the gateway's cache key function takes (see `cacheKey` in adapters-cf). */
export interface CacheKeyInput {
  url: string;
  method: string;
  consumerId?: string;
  vary?: Record<string, string | undefined>;
  ignoreQuery?: string[];
}

/** The cache the gateway supplies: a store and its key function. */
export interface ProxyCacheBackend {
  store: CacheStore;
  key(input: CacheKeyInput): Promise<string>;
  /** Query names that carry credentials (auth plugins' key names). */
  credentialParams?: string[];
}

type Status = (typeof KONG_CACHE_STATUS)[keyof typeof KONG_CACHE_STATUS];

declare module "hono" {
  interface ContextVariableMap {
    edgwayProxyCacheBackend?: ProxyCacheBackend;
    /** This request's cache decision, from access to header_filter. */
    edgwayProxyCache?: { key?: string; status: Status };
  }
}

/** Called by the gateway before the plugins run. */
export function setProxyCacheBackend(
  c: Context,
  backend: ProxyCacheBackend,
): void {
  c.set("edgwayProxyCacheBackend", backend);
}

const schema = kongSchema("proxy-cache");
type Config = PluginConfig<typeof schema>;

const MS_PER_SECOND = 1000;

/** Cache-Control directives, lower-cased, with their values. */
function directives(value: string | null | undefined): Map<string, string> {
  const map = new Map<string, string>();
  for (const part of (value ?? "").split(",")) {
    const [name = "", arg = ""] = part.split("=");
    if (name.trim()) map.set(name.trim().toLowerCase(), arg.trim());
  }
  return map;
}

const seconds = (value: string | undefined) => {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isNaN(n) ? undefined : n;
};

/** Kong's exact content-type match, or `*` wildcards. */
function cacheableType(config: Config, type: string | null): boolean {
  const actual = (type ?? "").trim().toLowerCase();
  return (config.content_type ?? []).some((allowed) => {
    const wanted = allowed.trim().toLowerCase();
    if (wanted === "*/*") return true;
    if (wanted.endsWith("/*")) return actual.startsWith(wanted.slice(0, -1));
    return actual === wanted;
  });
}

/**
 * Whether the key covers every request header the upstream says the
 * response varies on: `Vary: *`, or a header outside
 * `vary_headers`, means one entry could be served to requests the upstream
 * would answer differently. `Accept-Encoding` is the platform's to vary on.
 */
function keyCoversVary(config: Config, res: Response): boolean {
  const keyed = new Set(
    (config.vary_headers ?? []).map((name) => name.toLowerCase()),
  );
  keyed.add(HEADER.acceptEncoding);
  return (res.headers.get(HEADER.vary) ?? "")
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean)
    .every((name) => name !== "*" && keyed.has(name));
}

/** The TTL for a response, or undefined when it must not be stored. */
function responseTtl(config: Config, res: Response): number | undefined {
  if (!(config.response_code ?? []).includes(res.status)) return undefined;
  if (!cacheableType(config, res.headers.get(HEADER.contentType))) {
    return undefined;
  }
  // A response that sets cookies is one client's, never shared.
  if (res.headers.has(HEADER.setCookie)) return undefined;
  if (!keyCoversVary(config, res)) return undefined;
  const ttl = config.cache_ttl ?? 0;
  if (!config.cache_control) return ttl > 0 ? ttl : undefined;
  const cc = directives(res.headers.get(HEADER.cacheControl));
  if (
    cc.has(CACHE_DIRECTIVE.noStore) ||
    cc.has(CACHE_DIRECTIVE.noCache) ||
    cc.has(CACHE_DIRECTIVE.private)
  ) {
    return undefined;
  }
  // Kong's resource_ttl: s-maxage, max-age, then Expires; no fallback to
  // cache_ttl, so a response without freshness information is not stored.
  const expires = Date.parse(res.headers.get(HEADER.expires) ?? "");
  const fromOrigin =
    seconds(cc.get(CACHE_DIRECTIVE.sMaxAge)) ??
    seconds(cc.get(CACHE_DIRECTIVE.maxAge)) ??
    (Number.isNaN(expires)
      ? undefined
      : Math.floor((expires - Date.now()) / MS_PER_SECOND));
  return fromOrigin !== undefined && fromOrigin > 0 ? fromOrigin : undefined;
}

/** Kong's diagnostic headers, each switchable in `response_headers`. */
function diagnostics(config: Config, headers: Headers, key?: string) {
  const show = config.response_headers;
  return (status: Status, age?: number) => {
    if (show?.["X-Cache-Status"] ?? true) {
      headers.set(HEADER.cacheStatus, status);
    }
    if (key && (show?.["X-Cache-Key"] ?? true)) {
      headers.set(HEADER.cacheKey, key);
    }
    if (age !== undefined && (show?.age ?? true)) {
      headers.set(HEADER.age, String(age));
    }
  };
}

export default definePlugin({
  name: "proxy-cache",
  version: "1.0.0",
  priority: 100,
  config: schema,
  access: (config) => async (c, next) => {
    const backend = c.get("edgwayProxyCacheBackend");
    const method = c.req.method;
    const requestCc = directives(c.req.header(HEADER.cacheControl));
    const bypass =
      !backend ||
      !(config.request_method ?? ([] as string[])).includes(method as never) ||
      // Cookies with no consumer to key on: the upstream may answer each
      // client differently (its own session), so nothing is shared.
      (c.req.header(HEADER.cookie) !== undefined && !getConsumer(c)) ||
      (config.cache_control &&
        (requestCc.has(CACHE_DIRECTIVE.noStore) ||
          requestCc.has(CACHE_DIRECTIVE.noCache) ||
          c.req.header(HEADER.authorization) !== undefined));
    if (bypass || !backend) {
      c.set("edgwayProxyCache", { status: KONG_CACHE_STATUS.bypass });
      await next();
      return;
    }

    const url = new URL(c.req.url);
    if (config.ignore_uri_case) url.pathname = url.pathname.toLowerCase();
    if (config.vary_query_params) {
      const kept = new URLSearchParams();
      for (const name of config.vary_query_params) {
        for (const v of url.searchParams.getAll(name)) kept.append(name, v);
      }
      url.search = kept.toString();
    }
    const key = await backend.key({
      url: url.toString(),
      method,
      consumerId: getConsumer(c)?.id,
      vary: Object.fromEntries(
        (config.vary_headers ?? []).map((h) => [h, c.req.header(h)]),
      ),
      ignoreQuery: backend.credentialParams,
    });

    const hit = await backend.store.match(key);
    if (hit) {
      const cachedAt = Number(hit.headers.get(HEADER.cachedAt) ?? Date.now());
      const age = Math.max(
        0,
        Math.floor((Date.now() - cachedAt) / MS_PER_SECOND),
      );
      // Kong's freshness checks (cache_control): too old for the request's
      // max-age, past max-stale, or less fresh than min-fresh means Refresh.
      const ttl = Number(hit.headers.get(HEADER.cachedTtl) ?? 0);
      const wants = (d: string) =>
        config.cache_control ? seconds(requestCc.get(d)) : undefined;
      const maxAge = wants(CACHE_DIRECTIVE.maxAge);
      const maxStale = wants(CACHE_DIRECTIVE.maxStale);
      const minFresh = wants(CACHE_DIRECTIVE.minFresh);
      const fresh =
        (maxAge === undefined || age <= maxAge) &&
        (maxStale === undefined || age - ttl <= maxStale) &&
        (minFresh === undefined || ttl - age >= minFresh);
      if (fresh) {
        const headers = new Headers(hit.headers);
        // The storage headers are the adapter's; restore the upstream's own.
        headers.delete(HEADER.cacheTag);
        headers.delete(HEADER.cacheControl);
        const original = headers.get(HEADER.cachedCacheControl);
        if (original) headers.set(HEADER.cacheControl, original);
        headers.delete(HEADER.cachedCacheControl);
        headers.delete(HEADER.cachedAt);
        headers.delete(HEADER.cachedTtl);
        diagnostics(config, headers, key)(KONG_CACHE_STATUS.hit, age);
        c.set("edgwayProxyCache", { key, status: KONG_CACHE_STATUS.hit });
        return new Response(method === "HEAD" ? null : hit.body, {
          status: hit.status,
          statusText: hit.statusText,
          headers,
        });
      }
      await hit.body?.cancel();
    }
    c.set("edgwayProxyCache", {
      key,
      status: hit ? KONG_CACHE_STATUS.refresh : KONG_CACHE_STATUS.miss,
    });
    await next();
  },
  header_filter: (config) => (c) => {
    const state = c.get("edgwayProxyCache");
    const backend = c.get("edgwayProxyCacheBackend");
    if (!state || state.status === KONG_CACHE_STATUS.hit) return;
    const set = diagnostics(config, c.res.headers, state.key);
    const ttl = state.key && backend ? responseTtl(config, c.res) : undefined;
    // HEAD responses have no body: only GET fills the (shared) entry.
    if (ttl === undefined || !state.key || !backend || c.req.method !== "GET") {
      set(
        state.status === KONG_CACHE_STATUS.miss
          ? KONG_CACHE_STATUS.bypass
          : state.status,
      );
      return;
    }
    set(state.status);
    const stored = c.res.clone();
    const headers = new Headers(stored.headers);
    headers.delete(HEADER.cacheStatus);
    headers.delete(HEADER.cacheKey);
    const original = stored.headers.get(HEADER.cacheControl);
    if (original) headers.set(HEADER.cachedCacheControl, original);
    headers.set(HEADER.cachedAt, String(Date.now()));
    headers.set(HEADER.cachedTtl, String(ttl));
    const route = getRoute(c);
    const tags = [route?.route.id, route?.service?.id].filter(
      (tag): tag is string => Boolean(tag),
    );
    c.executionCtx.waitUntil(
      backend.store.put(
        state.key,
        new Response(stored.body, {
          status: stored.status,
          statusText: stored.statusText,
          headers,
        }),
        { ttlSeconds: ttl, tags },
      ),
    );
  },
});
