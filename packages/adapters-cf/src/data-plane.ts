/**
 * The data plane: the published snapshot (ConfigStore: KV + signed manifest,
 * no D1) compiled into Kong routes running the configured plugins
 * (@edgway/core), in front of the Upstream adapter. Rebuilt when the snapshot
 * version changes. The plugins arrive as a registry, so this package never
 * depends on them.
 */
import {
  ANALYTICS,
  HEADER,
  HTTP_LOG,
  IDENTITY_HEADERS,
  TRACE,
  UPSTREAM,
  VAULTS,
} from "@edgway/constants";
import {
  buildGateway,
  type ConfigStore,
  getConsumer,
  getRoute,
  type KongRoute,
  type KongService,
  type OnError,
  type PluginInstance,
  type PluginScope,
  pinClientIp,
  type SecretResolver,
  setConsumerGroups,
  setCredentialNames,
  type Upstream,
  type UpstreamTarget,
} from "@edgway/core";
import { ERR, fail } from "@edgway/errors";
import {
  ATTR_EDGWAY_PHASE,
  ATTR_EDGWAY_ROUTE_ID,
  ATTR_EDGWAY_ROUTES_SKIPPED,
  ATTR_EDGWAY_SERVICE_ID,
  ATTR_EDGWAY_UPSTREAMS_FALLBACK,
  EVENT,
  getLogger,
  type PluginMetric,
  SPAN,
} from "@edgway/telemetry";
import { type Context, Hono, type MiddlewareHandler } from "hono";
import { importJWK, type JWK, jwtVerify } from "jose";
import {
  type Balancer,
  createBalancer,
  type KongTarget,
  type KongUpstream,
} from "./balancer/index.js";
import {
  createConfigStore,
  SnapshotUnavailable,
  type VersionReader,
} from "./config/store.js";
import type { SnapshotCredentials } from "./plugin-backends/snapshot-stores.js";
import {
  type SnapshotSandboxPlugin,
  sandboxPlugins,
  type WorkerLoaderSandbox,
} from "./sandbox/index.js";
import {
  createSecretResolver,
  resolveSnapshotSecrets,
} from "./secrets/index.js";
import { traced } from "./tracing.js";
import { createUpstream } from "./upstream/index.js";

export interface SnapshotService extends KongService {
  name?: string | null;
  /** `edgway-binding:` / `edgway-tunnel:` tags select the target. */
  tags?: string[] | null;
  retries?: number;
  connect_timeout?: number;
  read_timeout?: number;
}

/** A Kong `plugins` row as the snapshot carries it. */
export interface SnapshotPlugin {
  id: string;
  name: string;
  route_id?: string | null;
  service_id?: string | null;
  consumer_id?: string | null;
  consumer_group_id?: string | null;
  enabled?: boolean;
  /** Overrides the plugin's default on failure; null: the default. */
  on_error?: OnError | null;
  config: Record<string, unknown>;
  /**
   * The config paths whose vault references the gateway resolves: the
   * fields Kong marks referenceable, set at publish. A reference
   * anywhere else leaves the plugin unresolved, so its routes fail closed.
   */
  vault_paths?: string[][];
}

/** The published config snapshot (field names as @edgway/schema's tables). */
export interface Snapshot extends SnapshotCredentials {
  services: SnapshotService[];
  routes: KongRoute[];
  plugins: SnapshotPlugin[];
  /** Uploaded plugins run in Dynamic Worker sandboxes. */
  sandbox_plugins?: SnapshotSandboxPlugin[];
  /** Kong upstreams and targets: a service host naming one is balanced. */
  upstreams?: (KongUpstream & { id: string })[];
  targets?: (KongTarget & { id?: string; upstream_id: string })[];
}

/** What the data plane needs from a plugin (`definePlugin`'s result). */
export interface PluginFactory {
  name: string;
  instance(input: {
    id: string;
    scope: PluginScope;
    config: unknown;
    on_error?: OnError;
  }): PluginInstance;
}

export interface DataPlaneEnv {
  CONFIG_KV: KVNamespace;
  /** The admin's snapshot-signing public key, as a JWK (not a secret). */
  CONFIG_PUBLIC_KEY: string;
  /**
   * The live version's only source when bound: the admin's
   * read-only `ConfigVersionReader` over a Service Binding.
   */
  CONFIG_VERSION?: VersionReader;
  /**
   * The public half of the admin's trace-token key: a key of its
   * own, not the snapshot key. Without it, no request is traced.
   */
  TRACE_PUBLIC_KEY?: string;
}

export interface DataPlaneOptions<E extends DataPlaneEnv> {
  plugins: Iterable<PluginFactory>;
  /**
   * Middleware run before every route's plugins, built once per snapshot
   * (the gateway's context stores). It runs outside the plugin runner, so
   * upstream errors still reach the outer app's error handler.
   */
  setup?: (snapshot: Snapshot, env: E) => MiddlewareHandler;
  upstream?: Upstream;
  /**
   * Where a service's tags look up Service Bindings and Workers VPC services
   *; defaults to the Worker's env. Only names starting with
   * `UPSTREAM.bindingPrefix` are ever reachable.
   */
  upstreamBindings?: (env: E) => Record<string, unknown>;
  /**
   * The sandbox for the snapshot's uploaded plugins. Without it,
   * plugins naming them are skipped like any plugin the gateway lacks.
   */
  sandbox?: (
    plugins: SnapshotSandboxPlugin[],
    env: E,
  ) => WorkerLoaderSandbox | undefined;
  /**
   * Resolves the snapshot's vault references. Defaults to Kong's
   * `env` vault over the Worker's own env (secrets and Secrets Store).
   */
  secrets?: (env: E) => SecretResolver;
  /** Called once per request with what it did (the gateway's metrics). */
  observe?: (c: Context<{ Bindings: E }>, request: ObservedRequest) => void;
  /**
   * Called for each plugin's work in each phase, at most
   * `ANALYTICS.pluginPointsPerRequest` times per request.
   */
  observePlugin?: (c: Context<{ Bindings: E }>, metric: PluginMetric) => void;
}

/** One proxied request, for metrics. */
export interface ObservedRequest {
  route?: string;
  service?: string;
  consumer?: string;
  method: string;
  status: number;
  durationMs: number;
}

/** One plugin's decision in a traced request (the route tester). */
export interface TraceEntry {
  plugin: string;
  id: string;
  phase: string;
  outcome: string;
  durationMs: number;
}

/** Where a traced request collects its entries (a Hono context variable). */
const TRACE_KEY = "edgwayTrace";

/** How many plugin metrics this request has reported (a Hono context variable). */
const PLUGIN_POINTS_KEY = "edgwayPluginPoints";

/**
 * The Service Bindings and Workers VPC services a service tag may name: the
 * fetchers whose names start with `UPSTREAM_`, so a tag can
 * never reach the gateway's own bindings.
 */
export const upstreamFetchers = (
  bindings: Record<string, unknown>,
): Record<string, Fetcher> =>
  Object.fromEntries(
    Object.entries(bindings).filter(
      ([name, value]) =>
        name.startsWith(UPSTREAM.bindingPrefix) &&
        typeof (value as Partial<Fetcher> | null)?.fetch === "function",
    ),
  ) as Record<string, Fetcher>;

/**
 * A balancer per upstream name, kept while its upstream and targets don't
 * change, so a publish doesn't reset round-robin or passive health.
 */
type Balancers = Map<string, { config: string; balancer: Balancer }>;

async function balancersFor(
  snapshot: Snapshot,
  previous: Balancers,
): Promise<Balancers> {
  const next: Balancers = new Map();
  for (const up of snapshot.upstreams ?? []) {
    const targets = (snapshot.targets ?? []).filter(
      (t) => t.upstream_id === up.id,
    );
    const config = JSON.stringify({ up, targets });
    const kept = previous.get(up.name);
    next.set(up.name, {
      config,
      balancer:
        kept?.config === config
          ? kept.balancer
          : await createBalancer(up, targets),
    });
  }
  return next;
}

/** The name after a service tag's prefix, if the service has one. */
const tagged = (service: SnapshotService, prefix: string) =>
  service.tags?.find((tag) => tag.startsWith(prefix))?.slice(prefix.length);

/**
 * Where a service sends: a Service Binding or Workers VPC service named by
 * its tags, else its URL. The upstream adapter balances a URL
 * whose host names a Kong upstream.
 */
function target(service: SnapshotService, path: string): UpstreamTarget {
  const binding = tagged(service, UPSTREAM.bindingTag);
  const tunnel = tagged(service, UPSTREAM.tunnelTag);
  const protocol = service.protocol ?? "http";
  const port = service.port ?? (protocol === "https" ? 443 : 80);
  return {
    kind: binding ? "binding" : tunnel ? "vpc" : "url",
    target: binding ?? tunnel ?? `${protocol}://${service.host}:${port}`,
    path,
    retries: service.retries,
    connectTimeoutMs: service.connect_timeout,
    readTimeoutMs: service.read_timeout,
  };
}

/**
 * A plugin that can't run (not in this gateway, or its secrets don't
 * resolve): it runs first on its routes and refuses the request, so the
 * route fails closed.
 */
const unavailable = (
  plugin: SnapshotPlugin,
  scope: PluginScope,
): PluginInstance => ({
  id: plugin.id,
  name: plugin.name,
  priority: Number.MAX_SAFE_INTEGER,
  scope,
  handlers: {
    access: () =>
      fail(ERR.PLUGIN_UNAVAILABLE, { extensions: { plugin: plugin.name } }),
  },
});

export function createDataPlane<E extends DataPlaneEnv>(
  options: DataPlaneOptions<E>,
): (c: Context<{ Bindings: E }>) => Promise<Response> {
  const registry = new Map([...options.plugins].map((p) => [p.name, p]));
  let store: ConfigStore<Snapshot> | undefined;
  let publicKey: CryptoKey | undefined;
  /** The trace-token key: imported once, null when none is set. */
  let traceKey: Promise<CryptoKey | null> | undefined;
  let balancerCache: Balancers = new Map();

  /** A trace token is valid when the admin signed it, for tracing, recently. */
  const traceAllowed = async (env: E, token: string) => {
    traceKey ??= env.TRACE_PUBLIC_KEY
      ? (
          importJWK(
            JSON.parse(env.TRACE_PUBLIC_KEY) as JWK,
            "EdDSA",
          ) as Promise<CryptoKey>
        ).catch(() => null)
      : Promise.resolve(null);
    const key = await traceKey;
    if (!key) return false;
    try {
      await jwtVerify(token, key, { audience: TRACE.audience });
      return true;
    } catch {
      return false;
    }
  };
  let built:
    | { version: number; app: Hono<{ Bindings: E }>; retryAt?: number }
    | undefined;

  async function build(
    env: E,
    snapshot: Snapshot,
  ): Promise<Hono<{ Bindings: E }>> {
    const services = new Map(snapshot.services.map((s) => [s.id, s]));
    // One balancer per Kong upstream, by name.
    balancerCache = await balancersFor(snapshot, balancerCache);
    const balancers = Object.fromEntries(
      [...balancerCache].map(([name, { balancer }]) => [name, balancer]),
    );
    const fetchers = upstreamFetchers(
      options.upstreamBindings?.(env) ??
        (env as unknown as Record<string, unknown>),
    );
    const upstream =
      options.upstream ??
      createUpstream({
        balancers,
        bindings: fetchers,
        vpc: Object.fromEntries(
          Object.entries(fetchers).map(([name, binding]) => [
            name,
            { binding },
          ]),
        ),
      });
    // Consumer group ids per consumer, for group-scoped plugins.
    const groupsOf = new Map<string, string[]>();
    for (const m of snapshot.consumer_group_consumers ?? []) {
      groupsOf.set(m.consumer_id, [
        ...(groupsOf.get(m.consumer_id) ?? []),
        m.consumer_group_id,
      ]);
    }
    const credentialNames = credentialNamesOf(snapshot);
    const uploaded = snapshot.sandbox_plugins ?? [];
    // Bundled plugins win over an uploaded one with the same name.
    const sandbox = uploaded.length > 0 && options.sandbox?.(uploaded, env);
    const factories = new Map<string, PluginFactory>([
      ...(sandbox
        ? sandboxPlugins(uploaded, sandbox).map((f) => [f.name, f] as const)
        : []),
      ...registry,
    ]);
    // Disabled plugins are skipped; an enabled one this gateway can't run
    // (not bundled, no sandbox, or unresolved secrets) fails its routes
    // closed.
    const instances = snapshot.plugins.flatMap((p) => {
      if (p.enabled === false) return [];
      const scope = {
        route: p.route_id ?? undefined,
        service: p.service_id ?? undefined,
        consumer: p.consumer_id ?? undefined,
        consumer_group: p.consumer_group_id ?? undefined,
      };
      const plugin = factories.get(p.name);
      if (!plugin || "unresolved" in p) return [unavailable(p, scope)];
      return [
        plugin.instance({
          id: p.id,
          scope,
          config: p.config,
          on_error: p.on_error ?? undefined,
        }),
      ];
    });
    const { app, skipped } = buildGateway(
      {
        routes: snapshot.routes,
        services: snapshot.services,
        plugins: instances,
        upstream: async (c, match) => {
          const service = match.service && services.get(match.service.id);
          if (!service) fail(ERR.UPSTREAM_UNREACHABLE);
          // The current query: plugins may have changed it (hide_credentials).
          const [path = ""] = match.upstreamPath.split("?");
          const search = new URL(c.req.url).search;
          const started = performance.now();
          const res = await traced(
            c,
            SPAN.upstream,
            {
              [ATTR_EDGWAY_ROUTE_ID]: match.route.id,
              [ATTR_EDGWAY_SERVICE_ID]: service.id,
            },
            () => upstream.forward(c, target(service, path + search)),
          );
          // A traced request records the upstream call in order with the
          // plugins, so the tester knows it was called.
          (c.get(TRACE_KEY as never) as TraceEntry[] | undefined)?.push({
            plugin: TRACE.upstream,
            id: service.id,
            phase: TRACE.upstream,
            outcome: "",
            durationMs: Math.round((performance.now() - started) * 100) / 100,
          });
          return res;
        },
      },
      {
        onEvent: (event, c) => {
          const durationMs = Math.round(event.durationMs * 100) / 100;
          // Plugin decisions, collected only for a traced request.
          (c.get(TRACE_KEY as never) as TraceEntry[] | undefined)?.push({
            plugin: event.plugin.name,
            id: event.plugin.id,
            phase: event.phase,
            outcome: event.outcome,
            durationMs,
          });
          // Per-plugin timing for the metrics, capped per request.
          if (!options.observePlugin) return;
          const reported = (c.get(PLUGIN_POINTS_KEY as never) as number) ?? 0;
          if (reported >= ANALYTICS.pluginPointsPerRequest) return;
          c.set(PLUGIN_POINTS_KEY as never, (reported + 1) as never);
          options.observePlugin(c as Context<{ Bindings: E }>, {
            plugin: event.plugin.name,
            pluginId: event.plugin.id,
            phase: event.phase,
            outcome: event.outcome,
            route: getRoute(c)?.route.id,
            durationMs,
          });
        },
        // A span per phase, under the platform's own.
        span: (c, phase, work) =>
          traced(
            c,
            SPAN.phase(phase),
            {
              [ATTR_EDGWAY_PHASE]: phase,
              [ATTR_EDGWAY_ROUTE_ID]: getRoute(c)?.route.id,
            },
            work,
          ),
      },
    );
    // Publish refuses these; a config signed before that still
    // runs without them, and says so.
    if (skipped.length > 0) {
      getLogger("data-plane").warn(EVENT.routesSkipped, {
        [ATTR_EDGWAY_ROUTES_SKIPPED]: skipped,
      });
    }
    // Kong algorithms the balancer runs as round-robin: the
    // publish warned; the data plane says so once per config, too.
    const fallback = (snapshot.upstreams ?? [])
      .filter((u) => u.algorithm && !UPSTREAM.algorithms.includes(u.algorithm))
      .map((u) => ({ id: u.id, name: u.name, algorithm: u.algorithm }));
    if (fallback.length > 0) {
      getLogger("data-plane").warn(EVENT.algorithmFallback, {
        [ATTR_EDGWAY_UPSTREAMS_FALLBACK]: fallback,
      });
    }
    const outer = new Hono<{ Bindings: E }>();
    outer.use(async (c, next) => {
      const started = performance.now();
      const token = c.req.header(HEADER.traceToken);
      const trace =
        token && (await traceAllowed(c.env, token)) ? [] : undefined;
      // The trace token is for the gateway only, and identity headers are
      // the gateway's to set: neither is forwarded from the client.
      const spoofed = [HEADER.traceToken, ...IDENTITY_HEADERS].filter((name) =>
        c.req.raw.headers.has(name),
      );
      if (spoofed.length > 0) {
        const headers = new Headers(c.req.raw.headers);
        for (const name of spoofed) headers.delete(name);
        c.req.raw = new Request(c.req.raw, { headers });
      }
      setConsumerGroups(c, (id) => groupsOf.get(id) ?? []);
      // The client IP as the platform set it, fixed for every plugin.
      pinClientIp(c, c.req.header(HEADER.clientIp));
      setCredentialNames(c, credentialNames);
      if (trace) c.set(TRACE_KEY as never, trace as never);
      const report = (status: number) => {
        const route = getRoute(c);
        options.observe?.(c, {
          route: route?.route.id,
          service: route?.service?.id,
          consumer: getConsumer(c)?.id,
          method: c.req.method,
          status,
          durationMs: performance.now() - started,
        });
      };
      try {
        await next();
      } catch (error) {
        // A thrown problem (fail) or HTTPException carries its status.
        const thrown = error as {
          status?: number;
          problemDetails?: { status?: number };
        };
        report(
          thrown.problemDetails?.status ?? thrown.status ?? ERR.INTERNAL.status,
        );
        throw error;
      }
      // Only the gateway writes a trace and names the matched route, for
      // traced requests only (the route tester), whether the upstream
      // or a plugin answered: an upstream's copy never passes.
      const route = trace ? getRoute(c)?.route.id : undefined;
      if (
        trace ||
        c.res.headers.has(HEADER.trace) ||
        c.res.headers.has(HEADER.route)
      ) {
        c.res = new Response(c.res.body, c.res);
        if (trace) c.res.headers.set(HEADER.trace, JSON.stringify(trace));
        else c.res.headers.delete(HEADER.trace);
        if (route) c.res.headers.set(HEADER.route, route);
        else c.res.headers.delete(HEADER.route);
      }
      report(c.res.status);
    });
    const setup = options.setup?.(snapshot, env);
    if (setup) outer.use(setup);
    outer.route("/", app);
    // Errors go to the outer app's handler, which renders and logs them.
    for (const a of [app, outer]) {
      a.onError((error) => {
        throw error;
      });
    }
    return outer;
  }

  return async (c) => {
    let current: Awaited<ReturnType<ConfigStore<Snapshot>["current"]>>;
    try {
      publicKey ??= (await importJWK(
        JSON.parse(c.env.CONFIG_PUBLIC_KEY) as JWK,
        "EdDSA",
      )) as CryptoKey;
      store ??= createConfigStore<Snapshot>({
        kv: c.env.CONFIG_KV,
        publicKey,
        versions: c.env.CONFIG_VERSION,
      });
      current = await store.current();
    } catch (error) {
      // No verified snapshot (before the first publish), or no public key:
      // a clear 503, not an unhandled 500.
      if (error instanceof SnapshotUnavailable || !publicKey) {
        fail(ERR.CONFIG_UNAVAILABLE);
      }
      throw error;
    }
    const { version, config } = current;
    // Rebuilt for a new version, and retried while a secret didn't resolve
    // (a vault outage shouldn't last until the next publish).
    if (
      built?.version !== version ||
      (built.retryAt !== undefined && Date.now() >= built.retryAt)
    ) {
      const resolver =
        options.secrets?.(c.env) ??
        createSecretResolver(c.env as unknown as Record<string, unknown>);
      const { snapshot, complete } = await resolveSnapshotSecrets(
        config,
        resolver,
      );
      built = {
        version,
        app: await build(c.env, snapshot),
        retryAt: complete ? undefined : Date.now() + VAULTS.retryMs,
      };
    }
    return built.app.fetch(c.req.raw, c.env, c.executionCtx);
  };
}

/**
 * The header and query names a config's auth plugins read credentials from
 *, as their configs name them; logging plugins redact them.
 */
export function credentialNamesOf(snapshot: Snapshot) {
  const headers = new Set<string>();
  const query = new Set<string>();
  for (const plugin of snapshot.plugins) {
    const fields = HTTP_LOG.credentialFields[plugin.name];
    if (!fields || plugin.enabled === false) continue;
    const config = (plugin.config ?? {}) as Record<string, unknown>;
    const names = (field: string) =>
      Array.isArray(config[field])
        ? (config[field] as unknown[]).map((n) => String(n).toLowerCase())
        : [];
    for (const field of fields.headers) {
      for (const name of names(field)) headers.add(name);
    }
    for (const field of fields.query) {
      for (const name of names(field)) query.add(name);
    }
  }
  return { headers: [...headers], query: [...query] };
}
