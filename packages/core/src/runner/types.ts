import type { Context, MiddlewareHandler } from "hono";

/** Kong's phases, minus `certificate` and `balancer` (PRD "Phases"). */
export type Phase =
  | "rewrite"
  | "access"
  | "header_filter"
  | "body_filter"
  | "log";

/** What happens when a plugin throws, times out or has an open circuit. */
export type OnError = "fail-open" | "fail-closed";

export interface PluginHandlers {
  /** Before route matching; runs for global plugins only. Hono middleware. */
  rewrite?: MiddlewareHandler;
  /** Auth, rate limits, request changes; may end the request. Hono middleware. */
  access?: MiddlewareHandler;
  /** Response header changes, after the upstream responds. */
  header_filter?: (c: Context) => void | Promise<void>;
  /** Response body changes as a stream transform; never buffer. */
  body_filter?: (
    c: Context,
  ) => TransformStream<Uint8Array, Uint8Array> | undefined;
  /** After the response, inside `waitUntil`. */
  log?: (c: Context) => void | Promise<void>;
}

/** The entities a plugin instance is bound to, by id (none: global). */
export interface PluginScope {
  route?: string;
  service?: string;
  consumer?: string;
  consumer_group?: string;
}

/** A configured plugin, ready to run: Kong's name, priority and scope. */
export interface PluginInstance {
  id: string;
  name: string;
  priority: number;
  scope: PluginScope;
  /**
   * Enforcement plugins (authentication, rate limiting, and access policies
   * such as acl or ip-restriction) fail closed unless `on_error` says
   * otherwise: if they break, the request stops.
   */
  enforces?: "auth" | "rate-limit" | "policy";
  on_error?: OnError;
  timeoutMs?: number;
  handlers: PluginHandlers;
}

/** The authenticated consumer, set by an auth plugin with `setConsumer`. */
export interface Consumer {
  id: string;
  /** Kong's authenticated groups (e.g. openid-connect's groups claim), for acl. */
  groups?: string[];
  /**
   * The consumer groups (ids) the consumer belongs to, for group-scoped
   * plugins: set only from the gateway's resolver, never from a credential
   * or a token.
   */
  consumerGroups?: string[];
  /** Set by an `anonymous` fallback: no credential was presented. */
  anonymous?: boolean;
}

/** Where a request is: its matched route and service, and its consumer once known. */
export interface RequestScope {
  route?: string;
  service?: string;
  consumer?: Consumer;
}

export type PluginOutcome =
  | "ok"
  | "short-circuit"
  | "error"
  | "timeout"
  | "circuit-open";

/**
 * Timing and what a plugin decided. Usually one per plugin per phase; a
 * middleware that rejects after `next()` adds a `short-circuit` after its `ok`.
 */
export interface PluginEvent {
  plugin: PluginInstance;
  phase: Phase;
  durationMs: number;
  outcome: PluginOutcome;
  error?: unknown;
}

/**
 * Runs one phase of a request inside a trace span (G2): the platform's
 * tracer, supplied by the adapter, which also names the span. `rewrite` and
 * `access` are middleware, so their spans enclose the phases and the
 * upstream call after them; `header_filter`, `body_filter` and `log` cover
 * only their own plugins.
 */
export type PhaseSpan = <T>(
  c: Context,
  phase: Phase,
  work: () => Promise<T>,
) => Promise<T>;

export interface RunnerOptions {
  /**
   * Per-plugin timing hook (metrics, spans, the route tester's trace). The
   * request's context comes second, for per-request collection.
   */
  onEvent?: (event: PluginEvent, c: Context) => void;
  /** Wraps each phase in a trace span; without it, phases run as they are. */
  span?: PhaseSpan;
}
