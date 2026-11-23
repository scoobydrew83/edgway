/**
 * Kong's cors (priority 2000) on hono/cors. A preflight (`OPTIONS` with
 * `Access-Control-Request-Method`) is answered in `access`, with Kong's 200
 * rather than hono's 204, unless `preflight_continue` sends it upstream.
 * Every other response, upstream or error, gets its CORS headers in
 * `header_filter`, so browsers can read errors too; a preflight sent upstream
 * gets none, as in Kong. This file maps Kong's origin matching (plain origins
 * or anchored regexes, a sole `*`, the Origin echoed back when credentials are
 * allowed) and `private_network` onto it.
 */
import { HEADER } from "@edgway/constants";
import { STATUS } from "@edgway/errors";
import { definePlugin, type PluginConfig } from "@edgway/plugin-sdk";
import { kongSchema } from "@edgway/schema";
import type { Context } from "hono";
import { cors } from "hono/cors";

const schema = kongSchema("cors");
type Config = PluginConfig<typeof schema>;

/** Kong treats an entry made only of these characters as a plain origin. */
const PLAIN_ORIGIN = /^[A-Za-z0-9.:/-]+$/;
const SCHEME = "://";
const WILDCARD = "*";

function parseOrigin(origin: string): URL | undefined {
  try {
    return new URL(origin);
  } catch {
    return undefined;
  }
}

/** Kong's origin matching: plain entries compare normalized; others are anchored regexes. */
function originMatcher(
  origins: readonly string[],
): (origin: string) => boolean {
  const matchers = origins.map((entry) => {
    if (!PLAIN_ORIGIN.test(entry)) {
      const pattern = new RegExp(`^(?:${entry})$`);
      return (origin: string) => pattern.test(origin);
    }
    if (entry.includes(SCHEME)) {
      const allowed = new URL(entry).origin;
      return (origin: string) => parseOrigin(origin)?.origin === allowed;
    }
    // Without a scheme, Kong's normalized entry is the text itself.
    return (origin: string) => origin === entry;
  });
  return (origin) => matchers.some((match) => match(origin));
}

function corsOptions(config: Config) {
  const origins = config.origins ?? [];
  // Kong allows every origin only when `*` is the sole entry (or none are set).
  const allowAll =
    origins.length === 0 || (origins.length === 1 && origins[0] === WILDCARD);
  const matches = originMatcher(origins.filter((o) => o !== WILDCARD));
  return {
    // Browsers reject `*` with credentials, so Kong echoes the Origin back.
    origin:
      allowAll && !config.credentials
        ? WILDCARD
        : (origin: string) =>
            origin && (allowAll || matches(origin)) ? origin : null,
    allowMethods: config.methods ?? [],
    allowHeaders: config.headers ?? [],
    exposeHeaders: config.exposed_headers ?? [],
    credentials: config.credentials,
    maxAge: config.max_age ?? undefined,
  };
}

/** Kong's preflight: OPTIONS with both Origin and Access-Control-Request-Method. */
const isPreflight = (c: Context) =>
  c.req.method === "OPTIONS" &&
  c.req.header(HEADER.origin) !== undefined &&
  c.req.header(HEADER.accessControlRequestMethod) !== undefined;

/** The headers Kong adds to a response that is not a preflight. */
const RESPONSE_HEADERS = [
  HEADER.accessControlAllowOrigin,
  HEADER.accessControlAllowCredentials,
  HEADER.accessControlExposeHeaders,
];

export default definePlugin({
  name: "cors",
  version: "1.0.0",
  priority: 2000,
  config: schema,
  access: (config) => {
    const middleware = cors(corsOptions(config));
    return async (c, next) => {
      if (!isPreflight(c) || config.preflight_continue) return next();
      const res = (await middleware(c, next)) as Response;
      const headers = new Headers(res.headers);
      if (
        config.private_network &&
        c.req.header(HEADER.accessControlRequestPrivateNetwork) === String(true)
      ) {
        headers.set(HEADER.accessControlAllowPrivateNetwork, String(true));
      }
      // Kong answers a preflight with 200 and an empty body.
      return new Response(null, { status: STATUS.ok, headers });
    };
  },
  header_filter: (config) => {
    const options = corsOptions(config);
    const middleware = cors(options);
    return async (c) => {
      // As in Kong, a preflight gets no response headers here: either the
      // plugin answered it in access, or (preflight_continue) the upstream owns it.
      if (isPreflight(c)) return;
      if (c.req.method !== "OPTIONS") {
        await middleware(c, async () => {});
        return;
      }
      // hono/cors treats every OPTIONS as a preflight; for a plain OPTIONS,
      // keep the upstream's headers and take only Kong's response headers.
      const upstream = new Headers(c.res.headers);
      await middleware(c, async () => {});
      const added = new Headers(c.res.headers);
      for (const name of [...c.res.headers.keys()]) c.res.headers.delete(name);
      upstream.forEach((value, name) => {
        c.res.headers.append(name, value);
      });
      for (const name of RESPONSE_HEADERS) {
        const value = added.get(name);
        if (value !== null) c.res.headers.set(name, value);
      }
      if (options.origin !== WILDCARD) {
        c.res.headers.append(HEADER.vary, HEADER.origin);
      }
    };
  },
});
