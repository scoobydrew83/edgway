/**
 * Native API endpoints behind the admin UI's console pages: the
 * plugin catalog and its JSON Schemas, the published and staged snapshots,
 * the route tester and the Analytics Engine overview. (Not under /plugins:
 * `/plugins/{id}` is the plugin entities.)
 */

import type { TraceEntry } from "@edgway/adapters-cf";
import {
  type AdminCore,
  importSigningKeys,
  liveVersion,
  publishedSnapshot,
  snapshotDiff,
} from "@edgway/admin-core";
import { ANALYTICS, HEADER, MEDIA_TYPE, TRACE } from "@edgway/constants";
import { selectPlugins } from "@edgway/core";
import { ERR, fail, STATUS } from "@edgway/errors";
import {
  overviewConsumersSql,
  overviewLatencySql,
  overviewRoutesSql,
  overviewSeriesSql,
} from "@edgway/telemetry";
import { type createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { SignJWT } from "jose";
import { PLUGINS, pluginJsonSchema, pluginPriority } from "./plugins";
import { versionSource } from "./publish";
import type { AdminRole } from "./roles";

export interface ConsoleEnv {
  /** The gateway, for the route tester: a service binding… */
  GATEWAY?: Fetcher;
  /** …or its URL (also the tester's base URL with the binding). */
  GATEWAY_URL?: string;
  /** The account whose Analytics Engine holds the gateway's metrics. */
  CF_ACCOUNT_ID?: string;
  /** Secret: an API token with Account Analytics read. */
  AE_API_TOKEN?: string;
  /**
   * Secret: the Ed25519 private JWK that signs trace tokens; the gateway's
   * TRACE_PUBLIC_KEY is its public half. A key of its own, not the snapshot
   * key. Without it, the route tester is off.
   */
  TRACE_SIGNING_KEY?: string;
}

/** The trace-token signing key, or a clear 503 while it isn't set. */
async function traceSigningKey(env: ConsoleEnv): Promise<CryptoKey> {
  if (!env.TRACE_SIGNING_KEY) {
    fail(ERR.ADMIN_DISABLED, { detail: "TRACE_SIGNING_KEY" });
  }
  return (await importSigningKeys(env.TRACE_SIGNING_KEY)).signingKey;
}

/** The catalog's groups: Kong Plugin Hub's categories. */
const PLUGIN_CATEGORY: Readonly<Record<string, string>> = {
  "basic-auth": "authentication",
  jwt: "authentication",
  "key-auth": "authentication",
  "openid-connect": "authentication",
  acl: "security",
  cors: "security",
  "ip-restriction": "security",
  "ai-prompt-guard": "ai",
  "ai-proxy": "ai",
  "ai-rate-limiting-advanced": "ai",
  "proxy-cache": "traffic-control",
  "rate-limiting": "traffic-control",
  "request-size-limiting": "traffic-control",
  "request-termination": "traffic-control",
  "correlation-id": "transformations",
  "request-transformer": "transformations",
  "response-transformer": "transformations",
  "http-log": "logging",
};

/** Methods the tester sends; GET and HEAD carry no body. */
const METHODS = [
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
] as const;
const BODYLESS = new Set(["GET", "HEAD"]);

type Route = (
  role: AdminRole,
  config: Parameters<typeof createRoute>[0],
  handler: (c: Context) => Promise<Response> | Response,
) => unknown;

const json = (schema: z.ZodType) => ({
  content: { [MEDIA_TYPE.json]: { schema } },
});

/** A snapshot with every secret masked, as the pending diff shows it. */
function masked(snapshot: Parameters<typeof snapshotDiff>[1]) {
  const tables: Record<string, Record<string, unknown>> = {};
  // Against nothing, every row is a CREATE carrying its masked value.
  for (const change of snapshotDiff(undefined, snapshot)) {
    if (change.type !== "CREATE") continue;
    const [table, key] = change.path.map(String);
    if (!table) continue;
    if (key === undefined) {
      tables[table] = change.value as Record<string, unknown>;
    } else {
      tables[table] ??= {};
      (tables[table] as Record<string, unknown>)[key] = change.value;
    }
  }
  return Object.fromEntries(
    Object.entries(tables).map(([table, rows]) => [table, Object.values(rows)]),
  );
}

/** Reads at most `limit` bytes of a body as text, then stops reading. */
async function head(body: ReadableStream<Uint8Array> | null, limit: number) {
  if (!body) return { text: "", truncated: false };
  const reader = body.getReader();
  const bytes = new Uint8Array(limit);
  let size = 0;
  let truncated = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const room = limit - size;
    bytes.set(value.subarray(0, room), size);
    size += Math.min(room, value.byteLength);
    if (value.byteLength > room) {
      truncated = true;
      await reader.cancel();
      break;
    }
  }
  // A character cut at the limit decodes as U+FFFD.
  return { text: new TextDecoder().decode(bytes.subarray(0, size)), truncated };
}

/** The gateway's trace header, or none if it isn't a valid trace. */
function traceOf(header: string | null): TraceEntry[] {
  try {
    const parsed = JSON.parse(header ?? "[]");
    return Array.isArray(parsed) ? (parsed as TraceEntry[]) : [];
  } catch {
    return [];
  }
}

const plugin = z.object({ name: z.string(), category: z.string() });
const testerBody = z.object({
  method: z.enum(METHODS).default("GET"),
  /** A path on the gateway (never another host). */
  path: z.string().regex(/^\/(?!\/)/),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.string().optional(),
});
const traceEntry = z.object({
  plugin: z.string(),
  id: z.string(),
  phase: z.string(),
  outcome: z.string(),
  durationMs: z.number(),
});
const testerResult = z.object({
  status: z.number(),
  headers: z.record(z.string(), z.string()),
  body: z.string(),
  truncated: z.boolean(),
  durationMs: z.number(),
  trace: z.array(traceEntry),
});
const whichQuery = z.object({
  route: z.string(),
  consumer: z.string().optional(),
  consumer_group: z.string().optional(),
});
const LEVELS = ["route", "service", "consumer", "consumer_group"] as const;
type Level = (typeof LEVELS)[number];
const whichPlugin = z.object({
  id: z.string(),
  name: z.string(),
  priority: z.number(),
  /** Where it was set: route, service, consumer, consumer_group, or none (global). */
  level: z.array(z.enum(LEVELS)),
  /** False: a more specific instance of the same plugin runs instead. */
  runs: z.boolean(),
});

const overviewQuery = z.object({
  hours: z
    .enum(ANALYTICS.overviewRanges.map(String) as [string, ...string[]])
    .optional(),
});

const overview = z.object({
  configured: z.boolean(),
  hours: z.number(),
  series: z.array(
    z.object({
      hour: z.string(),
      requests: z.number(),
      errors: z.number(),
      mean_ms: z.number(),
    }),
  ),
  routes: z.array(
    z.object({ route: z.string(), requests: z.number(), errors: z.number() }),
  ),
  /** p50 and p99 latency over the window; null without data. */
  latency: z.object({
    p50_ms: z.number().nullable(),
    p99_ms: z.number().nullable(),
  }),
  /** The busiest consumers over the window. */
  consumers: z.array(
    z.object({
      consumer: z.string(),
      requests: z.number(),
      errors: z.number(),
    }),
  ),
  /** The live config version and the last publish, analytics or not. */
  config: z.object({
    live: z.number().nullable(),
    last_publish: z
      .object({
        version: z.number(),
        created_at: z.number(),
        created_by: z.string(),
      })
      .nullable(),
  }),
});

export function consoleRoutes(
  route: Route,
  core: (c: Context) => AdminCore,
): void {
  route(
    "viewer",
    {
      tags: ["plugins"],
      method: "get",
      path: "/plugin-catalog",
      operationId: "plugin_catalog",
      responses: {
        [STATUS.ok]: {
          ...json(z.object({ data: z.array(plugin) })),
          description: "plugins",
        },
      },
    },
    (c) =>
      c.json({
        data: [...PLUGINS.keys()].map((name) => ({
          name,
          category: PLUGIN_CATEGORY[name] ?? "other",
        })),
      }),
  );
  // Which plugins run for a route and a caller: the gateway's own
  // precedence (`selectPlugins` from @edgway/core) over the staged config.
  route(
    "viewer",
    {
      tags: ["plugins"],
      method: "get",
      path: "/which-plugins",
      operationId: "which_plugins",
      request: { query: whichQuery },
      responses: {
        [STATUS.ok]: {
          ...json(z.object({ data: z.array(whichPlugin) })),
          description: "plugins",
        },
      },
    },
    async (c) => {
      const q = (c.req.valid as (t: "query") => z.infer<typeof whichQuery>)(
        "query",
      );
      const snapshot = await core(c).compileSnapshot();
      const route = snapshot.routes.find((r) => r.id === q.route);
      if (!route) fail(ERR.ADMIN_NOT_FOUND);
      const groups = q.consumer
        ? (snapshot.consumer_group_consumers ?? [])
            .filter((m) => m.consumer_id === q.consumer)
            .map((m) => m.consumer_group_id)
        : q.consumer_group
          ? [q.consumer_group]
          : [];
      // A caller known only by a group has no consumer id of its own.
      const consumer =
        q.consumer || groups.length > 0
          ? { id: q.consumer ?? "", consumerGroups: groups }
          : undefined;
      const request = {
        route: route?.id,
        service: route?.service_id ?? undefined,
        consumer,
      };
      const uploaded = new Map(
        (snapshot.sandbox_plugins ?? []).map((p) => [p.name, p.priority]),
      );
      // Disabled plugins never run (the gateway skips them).
      const instances = snapshot.plugins
        .filter((p) => p.enabled !== false)
        .map((p) => ({
          id: p.id,
          name: p.name,
          priority: pluginPriority(p.name) ?? uploaded.get(p.name) ?? 0,
          scope: {
            route: p.route_id ?? undefined,
            service: p.service_id ?? undefined,
            consumer: p.consumer_id ?? undefined,
            consumer_group: p.consumer_group_id ?? undefined,
          },
          handlers: {},
        }));
      const winners = selectPlugins(instances, request);
      // The scope keys an instance was set at (none: global).
      const level = (scope: Partial<Record<Level, string>>) =>
        LEVELS.filter((key) => scope[key] !== undefined);
      return c.json({
        data: winners.flatMap((winner) => [
          {
            id: winner.id,
            name: winner.name,
            priority: winner.priority,
            level: level(winner.scope),
            runs: true,
          },
          // The instances it replaces: same plugin, also applies, less specific.
          ...instances
            .filter(
              (other) =>
                other.name === winner.name &&
                other.id !== winner.id &&
                selectPlugins([other], request).length > 0,
            )
            .map((other) => ({
              id: other.id,
              name: other.name,
              priority: other.priority,
              level: level(other.scope),
              runs: false,
            })),
        ]),
      });
    },
  );
  route(
    "viewer",
    {
      tags: ["plugins"],
      method: "get",
      path: "/plugin-schemas/{name}",
      operationId: "plugin_schema",
      request: { params: z.object({ name: z.string() }) },
      responses: {
        [STATUS.ok]: {
          ...json(z.record(z.string(), z.unknown())),
          description: "plugins",
        },
      },
    },
    (c) => {
      const name = c.req.param("name") ?? "";
      const schema = pluginJsonSchema(name);
      if (!schema) fail(ERR.ADMIN_NOT_FOUND);
      return c.json(schema as Record<string, unknown>);
    },
  );

  route(
    "viewer",
    {
      tags: ["config"],
      method: "get",
      path: "/config/snapshots",
      operationId: "config_snapshots",
      responses: {
        [STATUS.ok]: {
          ...json(
            z.object({
              version: z.number().nullable(),
              published: z.record(z.string(), z.array(z.unknown())),
              staged: z.record(z.string(), z.array(z.unknown())),
            }),
          ),
          description: "config",
        },
      },
    },
    async (c) => {
      const source = versionSource(c);
      const version = await liveVersion(source);
      const published = await publishedSnapshot(source.kv, version);
      return c.json({
        version: version ?? null,
        published: published ? masked(published) : {},
        staged: masked(await core(c).compileSnapshot()),
      });
    },
  );

  route(
    "editor",
    {
      tags: ["tester"],
      method: "post",
      path: "/tester",
      operationId: "test_route",
      request: { body: json(testerBody) },
      responses: {
        [STATUS.ok]: {
          ...json(testerResult),
          description: "tester",
        },
      },
    },
    async (c) => {
      const env = c.env as ConsoleEnv;
      const input = (c.req.valid as (t: "json") => z.infer<typeof testerBody>)(
        "json",
      );
      // Sent through the GATEWAY binding when declared; GATEWAY_URL
      // still names the host, so host-matched routes resolve as in production.
      const base = env.GATEWAY_URL || (env.GATEWAY && "http://gateway");
      if (!base) fail(ERR.ADMIN_TESTER_UNCONFIGURED);
      // The path is resolved, then held to the gateway's origin: URL parsing
      // reads `\` as `/` and drops tabs, so a path check alone can't.
      const url = new URL(input.path, base);
      if (url.origin !== new URL(base).origin) {
        fail(ERR.ADMIN_TESTER_BAD_REQUEST);
      }
      if (input.body !== undefined && BODYLESS.has(input.method)) {
        fail(ERR.ADMIN_TESTER_BAD_REQUEST);
      }
      const token = await new SignJWT({})
        .setProtectedHeader({ alg: "EdDSA" })
        .setAudience(TRACE.audience)
        .setIssuedAt()
        .setExpirationTime(TRACE.tokenTtl)
        .sign(await traceSigningKey(env));
      const headers = new Headers(input.headers);
      headers.set(HEADER.traceToken, token);
      // The gateway trusts the client IP a Service Binding call carries: the
      // tester sends the editor's own, never one they typed.
      headers.delete(HEADER.forwardedFor);
      const ip = c.req.header(HEADER.clientIp);
      if (ip) headers.set(HEADER.clientIp, ip);
      else headers.delete(HEADER.clientIp);
      const request = new Request(url, {
        method: input.method,
        headers,
        body: input.body,
      });
      const started = performance.now();
      const res = await (env.GATEWAY
        ? env.GATEWAY.fetch(request)
        : fetch(request));
      const durationMs = performance.now() - started;
      const trace = traceOf(res.headers.get(HEADER.trace));
      const responseHeaders = Object.fromEntries(
        [...res.headers].filter(([name]) => name !== HEADER.trace),
      );
      const { text, truncated } = await head(res.body, TRACE.maxBodyBytes);
      return c.json({
        status: res.status,
        headers: responseHeaders,
        body: text,
        truncated,
        durationMs,
        trace,
      });
    },
  );

  route(
    "viewer",
    {
      tags: ["analytics"],
      method: "get",
      path: "/analytics/overview",
      operationId: "analytics_overview",
      // One of ANALYTICS.overviewRanges; anything else is a 400.
      request: { query: overviewQuery },
      responses: {
        [STATUS.ok]: { ...json(overview), description: "analytics" },
      },
    },
    async (c) => {
      const env = c.env as ConsoleEnv;
      const { hours: asked } = (
        c.req.valid as (t: "query") => z.infer<typeof overviewQuery>
      )("query");
      const hours = asked ? Number(asked) : ANALYTICS.overviewHours;
      // The config version comes from the admin itself, analytics or not.
      const [live, last] = await Promise.all([
        liveVersion(versionSource(c)),
        core(c).config.latest(),
      ]);
      const config = {
        live: live ?? null,
        last_publish: last
          ? {
              version: last.version,
              created_at: last.created_at,
              created_by: last.created_by,
            }
          : null,
      };
      if (!env.CF_ACCOUNT_ID || !env.AE_API_TOKEN) {
        return c.json({
          configured: false,
          hours,
          series: [],
          routes: [],
          latency: { p50_ms: null, p99_ms: null },
          consumers: [],
          config,
        });
      }
      // Loaded here: adapters-cf pulls in workerd modules that
      // `scripts/openapi.ts` (Node) can't load.
      const { analyticsSql } = await import("@edgway/adapters-cf");
      const query = analyticsSql({
        accountId: env.CF_ACCOUNT_ID,
        apiToken: env.AE_API_TOKEN,
      });
      // The SQL API returns 64-bit sums as strings.
      const numbers = <T extends Record<string, unknown>>(
        rows: T[],
        keys: string[],
      ) =>
        rows.map((row) =>
          Object.fromEntries(
            Object.entries(row).map(([k, v]) => [
              k,
              keys.includes(k) ? Number(v) : v,
            ]),
          ),
        );
      const [series, routes, latency, consumers] = await Promise.all([
        query<Record<string, unknown>>(overviewSeriesSql(hours)),
        query<Record<string, unknown>>(
          overviewRoutesSql(hours, ANALYTICS.topRoutes),
        ),
        query<Record<string, unknown>>(overviewLatencySql(hours)),
        query<Record<string, unknown>>(
          overviewConsumersSql(hours, ANALYTICS.topConsumers),
        ),
      ]);
      // No requests in the window: no quantiles (the API returns NaN or 0).
      const quantile = (value: unknown) => {
        const n = Number(value);
        return Number.isFinite(n) && series.length > 0 ? n : null;
      };
      return c.json({
        configured: true,
        hours,
        series: numbers(series, ["requests", "errors", "mean_ms"]),
        routes: numbers(routes, ["requests", "errors"]),
        latency: {
          p50_ms: quantile(latency[0]?.p50_ms),
          p99_ms: quantile(latency[0]?.p99_ms),
        },
        consumers: numbers(consumers, ["requests", "errors"]),
        config,
      });
    },
  );
}
