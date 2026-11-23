/**
 * Telemetry field names. Standard ones come from OpenTelemetry's semantic
 * conventions; Edgway-specific ones use the `edgway.` namespace. Dashboards and
 * log pipelines key on these, so they never change once shipped.
 */
export {
  ATTR_ERROR_TYPE,
  ATTR_EXCEPTION_MESSAGE,
  ATTR_EXCEPTION_STACKTRACE,
  ATTR_HTTP_REQUEST_METHOD,
  ATTR_HTTP_RESPONSE_STATUS_CODE,
  ATTR_URL_PATH,
} from "@opentelemetry/semantic-conventions";

export const ATTR_EDGWAY_REQUEST_ID = "edgway.request.id";
export const ATTR_EDGWAY_ROUTE_ID = "edgway.route.id";
export const ATTR_EDGWAY_ERROR_CODE = "edgway.error.code";
/** Routes the data plane left out: their id and the unsupported field. */
export const ATTR_EDGWAY_ROUTES_SKIPPED = "edgway.routes.skipped";

/** Upstreams whose algorithm runs as round-robin: id, name, algorithm. */
export const ATTR_EDGWAY_UPSTREAMS_FALLBACK = "edgway.upstreams.fallback";
/** A traced phase: Kong's phase name. */
export const ATTR_EDGWAY_PHASE = "edgway.phase";
/** The service a request was sent to. */
export const ATTR_EDGWAY_SERVICE_ID = "edgway.service.id";

/**
 * Span names (Workers custom spans, exported over OTLP): one per plugin
 * phase of a request, and one for the upstream call.
 */
export const SPAN = {
  phase: (phase: string) => `edgway.phase.${phase}`,
  upstream: "edgway.upstream",
} as const;

/** Log event names (structured logs use an event name, not prose). */
export const EVENT = {
  unhandledError: "gateway.unhandled_error",
  /** A published config had routes the router can't compile. */
  routesSkipped: "gateway.routes_skipped",
  /**
   * A published config has upstreams whose algorithm the gateway runs as
   * round-robin (`least-connections`, `latency`).
   */
  algorithmFallback: "gateway.upstream_algorithm_fallback",
} as const;
