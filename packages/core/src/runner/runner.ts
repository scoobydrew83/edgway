/**
 * Kong's phases on Hono middleware. `rewritePhase` mounts before routing;
 * `routePhases` mounts on each compiled route, in front of the upstream handler.
 */
import { HEADER } from "@edgway/constants";
import { ERR, problemResponse } from "@edgway/errors";
import type { Context, MiddlewareHandler, Next } from "hono";
import { guarded, isDeliberate, onErrorOf } from "./guard.js";
import { boundKeys, byPriority, selectPlugins } from "./select.js";
import type {
  Consumer,
  Phase,
  PluginInstance,
  PluginOutcome,
  RequestScope,
  RunnerOptions,
} from "./types.js";

/** Runs a phase in the options' span, or as it is without one. */
const spanned =
  (options: RunnerOptions) =>
  <T>(c: Context, phase: Phase, work: () => Promise<T>): Promise<T> =>
    options.span ? options.span(c, phase, work) : work();

declare module "hono" {
  interface ContextVariableMap {
    edgwayConsumer?: Consumer;
    edgwayConsumerGroups?: (consumerId: string) => string[];
    edgwayClientIp?: string | null;
    edgwayCredentialNames?: CredentialNames;
  }
}

/** Where a published config's auth plugins read credentials. */
export interface CredentialNames {
  /** Header names, lower-cased. */
  headers: readonly string[];
  /** Query parameter names, lower-cased. */
  query: readonly string[];
}

/**
 * Called by the gateway before any plugin runs: the header and query names
 * the config's auth plugins read credentials from (key-auth's `key_names`,
 * jwt's), so logging plugins can keep them out of logs.
 */
export function setCredentialNames(c: Context, names: CredentialNames): void {
  c.set("edgwayCredentialNames", names);
}

export function getCredentialNames(c: Context): CredentialNames | undefined {
  return c.get("edgwayCredentialNames");
}

/**
 * Called by the gateway before any plugin runs: the client's IP, as
 * the platform gave it. Every plugin then sees that IP in `cf-connecting-ip`
 * (ip-restriction, rate-limiting, the balancer's hashing): a plugin before
 * it, sandboxed or not, can't change it.
 */
export function pinClientIp(c: Context, ip: string | undefined): void {
  c.set("edgwayClientIp", ip ?? null);
}

/** Put the pinned client IP back if a plugin changed it. */
function restoreClientIp(c: Context): void {
  const pinned = c.get("edgwayClientIp");
  if (pinned === undefined) return;
  const current = c.req.raw.headers.get(HEADER.clientIp);
  if (current === pinned) return;
  const headers = new Headers(c.req.raw.headers);
  if (pinned === null) headers.delete(HEADER.clientIp);
  else headers.set(HEADER.clientIp, pinned);
  c.req.raw = new Request(c.req.raw, { headers });
}

/**
 * Called by the gateway before any plugin runs: the consumer groups (ids) a
 * consumer belongs to, so consumer-group-scoped plugins apply.
 */
export function setConsumerGroups(
  c: Context,
  groups: (consumerId: string) => string[],
): void {
  c.set("edgwayConsumerGroups", groups);
}

/** Called by auth plugins once they identify the consumer. */
export function setConsumer(c: Context, consumer: Consumer): void {
  // Membership comes only from the gateway's resolver.
  const { consumerGroups: _ignored, ...rest } = consumer;
  const consumerGroups = c.get("edgwayConsumerGroups")?.(consumer.id);
  c.set("edgwayConsumer", consumerGroups ? { ...rest, consumerGroups } : rest);
}

export function getConsumer(c: Context): Consumer | undefined {
  return c.get("edgwayConsumer");
}

type Emit = (
  c: Context,
  plugin: PluginInstance,
  phase: Phase,
  started: number,
  outcome: PluginOutcome,
  error?: unknown,
) => void;

const emitter =
  (options: RunnerOptions): Emit =>
  (c, plugin, phase, started, outcome, error) =>
    options.onEvent?.(
      {
        plugin,
        phase,
        durationMs: performance.now() - started,
        outcome,
        error,
      },
      c,
    );

/**
 * Replace whatever response exists with a 500 problem. Clearing `c.res` first
 * stops Hono from copying the upstream's headers (content-length, cookies)
 * onto the error response; the upstream body is cancelled, not read.
 */
function replaceResponse(c: Context, response: Response): void {
  if (c.finalized) {
    c.res.body?.cancel().catch(() => {});
    c.res = undefined as unknown as Response;
  }
  c.res = response;
}

const failClosed = (c: Context) =>
  replaceResponse(c, problemResponse(ERR.INTERNAL));

/** A deliberate rejection (e.g. `fail(ERR.AUTH_REQUIRED)`) ends the request like a returned Response. */
const deliberateResponse = (error: unknown) =>
  (error as { getResponse(): Response }).getResponse();

/**
 * Run one plugin's middleware. Only its own work before `next()` is timed and
 * guarded; the rest of the chain runs inside `next()` as usual.
 */
async function runMiddleware(
  c: Context,
  plugin: PluginInstance,
  phase: "rewrite" | "access",
  handler: MiddlewareHandler,
  downstream: () => Promise<void>,
  emit: Emit,
): Promise<void> {
  let reachedNext = false;
  let abandoned = false;
  let signalNext = () => {};
  const nextReached = new Promise<void>((resolve) => {
    signalNext = resolve;
  });
  const next: Next = async () => {
    if (reachedNext || abandoned) return;
    reachedNext = true;
    signalNext();
    await downstream();
  };

  const started = performance.now();
  let running: Promise<unknown> = Promise.resolve();
  let pre: Awaited<ReturnType<typeof guarded<void>>>;
  try {
    pre = await guarded(plugin, async () => {
      running = Promise.resolve(handler(c, next));
      await Promise.race([running, nextReached]);
    });
  } catch (error) {
    // guarded rethrows only deliberate responses: a short circuit.
    abandoned = true;
    replaceResponse(c, deliberateResponse(error));
    emit(c, plugin, phase, started, "short-circuit");
    return;
  }

  if (!pre.ok) {
    abandoned = true;
    running.catch(() => {});
    emit(c, plugin, phase, started, pre.outcome, pre.error);
    if (reachedNext) return settle(c, plugin, phase, running, emit);
    if (onErrorOf(plugin) === "fail-closed") return failClosed(c);
    // A plugin stopped part way through reading the body can't be skipped:
    // what's left of the body isn't the request any more.
    if (bodyTouched(c.req.raw)) return failClosed(c);
    return downstream();
  }

  if (!reachedNext) {
    const result = await running;
    if (result instanceof Response) c.res = result;
    emit(c, plugin, phase, started, "short-circuit");
    return;
  }
  emit(c, plugin, phase, started, "ok");
  return settle(c, plugin, phase, running, emit);
}

/** Whether a request's body has been read, or is being read. */
const bodyTouched = (request: Request) =>
  request.bodyUsed || request.body?.locked === true;

/** Wait for a middleware's work after `next()`; failures there follow on_error. */
async function settle(
  c: Context,
  plugin: PluginInstance,
  phase: Phase,
  running: Promise<unknown>,
  emit: Emit,
): Promise<void> {
  const started = performance.now();
  try {
    await running;
  } catch (error) {
    if (isDeliberate(error)) {
      replaceResponse(c, error.getResponse());
      emit(c, plugin, phase, started, "short-circuit");
      return;
    }
    emit(c, plugin, phase, started, "error", error);
    if (onErrorOf(plugin) === "fail-closed") failClosed(c);
  }
}

/** Run plugins' middleware in order, each wrapping the rest of the chain. */
function chain(
  c: Context,
  phase: "rewrite" | "access",
  plugins: PluginInstance[],
  last: () => Promise<void>,
  emit: Emit,
  after?: (plugin: PluginInstance, rest: PluginInstance[]) => PluginInstance[],
): Promise<void> {
  const step = (list: PluginInstance[], index: number): Promise<void> => {
    const plugin = list[index];
    const handler = plugin?.handlers[phase];
    if (!plugin || !handler) return last();
    return runMiddleware(
      c,
      plugin,
      phase,
      handler,
      () => {
        restoreClientIp(c);
        const rest = after ? after(plugin, list.slice(index + 1)) : undefined;
        return rest ? step(rest, 0) : step(list, index + 1);
      },
      emit,
    );
  };
  return step(plugins, 0);
}

/** `rewrite` phase: global plugins, before route matching. */
export function rewritePhase(
  plugins: readonly PluginInstance[],
  options: RunnerOptions = {},
): MiddlewareHandler {
  const emit = emitter(options);
  const globals = selectPlugins(plugins, {}).filter(
    (plugin) => boundKeys(plugin.scope).length === 0 && plugin.handlers.rewrite,
  );
  if (globals.length === 0) return (_c, next) => next();
  const span = spanned(options);
  return (c, next) =>
    span(c, "rewrite", () =>
      chain(c, "rewrite", globals, async () => void (await next()), emit),
    );
}

export interface RouteRunnerConfig {
  route?: string;
  service?: string;
  /** Every plugin that may apply to this route; selection happens per request. */
  plugins: readonly PluginInstance[];
}

/**
 * `access` → (upstream via `next`) → `header_filter` → `body_filter` → `log`
 * for one route. Consumer-scoped plugins join once an auth plugin sets the
 * consumer, as in Kong.
 */
export function routePhases(
  config: RouteRunnerConfig,
  options: RunnerOptions = {},
): MiddlewareHandler {
  const emit = emitter(options);
  const span = spanned(options);
  const has = (phase: Phase) => (plugin: PluginInstance) =>
    plugin.handlers[phase] !== undefined;

  return async (c, next) => {
    const scope: RequestScope = {
      route: config.route,
      service: config.service,
    };
    let selected = selectPlugins(config.plugins, scope);
    const ran = new Set<string>();

    // Once the consumer is known, re-select the plugins not run yet.
    const reselect = (current: PluginInstance, rest: PluginInstance[]) => {
      ran.add(current.name);
      const consumer = getConsumer(c);
      if (consumer?.id === scope.consumer?.id) return rest;
      scope.consumer = consumer;
      selected = selectPlugins(config.plugins, scope);
      return selected.filter(
        (plugin) =>
          has("access")(plugin) &&
          !ran.has(plugin.name) &&
          byPriority(current, plugin) < 0,
      );
    };

    const access = selected.filter(has("access"));
    const runAccess = () =>
      chain(
        c,
        "access",
        access,
        async () => void (await next()),
        emit,
        reselect,
      );
    await (access.length > 0 ? span(c, "access", runAccess) : runAccess());

    // An auth plugin may set the consumer and then reject: consumer-scoped
    // plugins still get the later phases.
    const consumer = getConsumer(c);
    if (consumer?.id !== scope.consumer?.id) {
      scope.consumer = consumer;
      selected = selectPlugins(config.plugins, scope);
    }

    const headerFilters = selected.filter(has("header_filter"));
    if (headerFilters.length > 0) {
      await span(c, "header_filter", async () => {
        for (const plugin of headerFilters) {
          await hook(c, plugin, "header_filter", emit, async () =>
            plugin.handlers.header_filter?.(c),
          );
        }
      });
    }

    const transforms: TransformStream<Uint8Array, Uint8Array>[] = [];
    const bodyFilters = selected.filter(has("body_filter"));
    if (bodyFilters.length > 0) {
      await span(c, "body_filter", async () => {
        for (const plugin of bodyFilters) {
          const transform = await hook(
            c,
            plugin,
            "body_filter",
            emit,
            async () => plugin.handlers.body_filter?.(c),
          );
          if (transform) transforms.push(transform);
        }
      });
    }
    if (transforms.length > 0 && c.res.body) {
      const body = transforms.reduce<ReadableStream<Uint8Array>>(
        (stream, transform) => stream.pipeThrough(transform),
        c.res.body,
      );
      const headers = new Headers(c.res.headers);
      // The transformed body's length is unknown until it is streamed.
      headers.delete(HEADER.contentLength);
      const { status, statusText } = c.res;
      c.res = undefined as unknown as Response;
      c.res = new Response(body, { status, statusText, headers });
    }

    const loggers = selected.filter(has("log"));
    if (loggers.length > 0) {
      const logs = (async () => {
        // Kong's log phase runs after the response is final.
        await new Promise((resolve) => setTimeout(resolve, 0));
        await span(c, "log", async () => {
          for (const plugin of loggers) {
            await hook(
              c,
              plugin,
              "log",
              emit,
              async () => plugin.handlers.log?.(c),
              false,
            );
          }
        });
      })();
      waitUntil(c, logs);
    }
  };
}

/**
 * Run a non-middleware phase handler under the plugin's guard. Failures follow
 * on_error; a deliberate rejection replaces the response. In `log` the
 * response is already sent, so nothing changes it.
 */
async function hook<T>(
  c: Context,
  plugin: PluginInstance,
  phase: Phase,
  emit: Emit,
  work: () => Promise<T>,
  canRespond = true,
): Promise<T | undefined> {
  const started = performance.now();
  try {
    const result = await guarded(plugin, work);
    if (result.ok) {
      emit(c, plugin, phase, started, "ok");
      return result.value;
    }
    emit(c, plugin, phase, started, result.outcome, result.error);
    if (canRespond && onErrorOf(plugin) === "fail-closed") failClosed(c);
  } catch (error) {
    // guarded rethrows only deliberate responses.
    if (!canRespond) emit(c, plugin, phase, started, "error", error);
    else {
      replaceResponse(c, deliberateResponse(error));
      emit(c, plugin, phase, started, "short-circuit");
    }
  }
  return undefined;
}

function waitUntil(c: Context, promise: Promise<void>): void {
  try {
    c.executionCtx.waitUntil(promise);
  } catch {
    // No execution context (e.g. app.request in tests): let it run detached.
    promise.catch(() => {});
  }
}
