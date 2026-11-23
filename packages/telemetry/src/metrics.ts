/**
 * Request metrics (PRD "Telemetry": Analytics Engine). The dataset's layout
 * lives here, so the gateway's writer and the admin's overview queries agree
 * on which blob and double holds what. Analytics Engine names columns by
 * position (blob1…, double1…), so the order never changes once shipped.
 */
import { ANALYTICS } from "@edgway/constants";

/** The Analytics Engine dataset the gateway writes (its wrangler binding names it too). */
export const REQUEST_DATASET = "edgway_requests";

/** Positional columns: blob1 = route id, blob2 = service id, … */
const BLOBS = ["route", "service", "consumer", "method"] as const;
const DOUBLES = ["status", "duration_ms"] as const;

const column = (kind: "blob" | "double", names: readonly string[]) =>
  Object.fromEntries(names.map((n, i) => [n, `${kind}${i + 1}`]));

/** SQL column names per field, e.g. `REQUEST_COLUMNS.route` = `blob1`. */
export const REQUEST_COLUMNS = {
  ...column("blob", BLOBS),
  ...column("double", DOUBLES),
} as Record<(typeof BLOBS)[number] | (typeof DOUBLES)[number], string>;

/** One request as the gateway reports it. */
export interface RequestMetric {
  route?: string;
  service?: string;
  consumer?: string;
  method: string;
  status: number;
  durationMs: number;
}

/** Analytics Engine's `writeDataPoint` argument (structurally). */
export interface DataPoint {
  indexes: string[];
  blobs: string[];
  doubles: number[];
}

/** The data point for one request; sampled per route (the index). */
export function requestDataPoint(metric: RequestMetric): DataPoint {
  return {
    indexes: [metric.route ?? ""],
    blobs: [
      metric.route ?? "",
      metric.service ?? "",
      metric.consumer ?? "",
      metric.method,
    ],
    doubles: [metric.status, metric.durationMs],
  };
}

/**
 * Per-plugin timing: one data point per plugin per phase, in a
 * dataset of its own so request counts stay one row per request. Indexed
 * (and so sampled) by plugin name.
 */
export const PLUGIN_DATASET = "edgway_plugins";

const PLUGIN_BLOBS = [
  "plugin",
  "phase",
  "outcome",
  "route",
  "plugin_id",
] as const;
const PLUGIN_DOUBLES = ["duration_ms"] as const;

/** SQL column names per field of the plugin dataset. */
export const PLUGIN_COLUMNS = {
  ...column("blob", PLUGIN_BLOBS),
  ...column("double", PLUGIN_DOUBLES),
} as Record<
  (typeof PLUGIN_BLOBS)[number] | (typeof PLUGIN_DOUBLES)[number],
  string
>;

/** One plugin's work in one phase of a request. */
export interface PluginMetric {
  plugin: string;
  pluginId: string;
  phase: string;
  outcome: string;
  route?: string;
  durationMs: number;
}

/** The data point for one plugin's work in one phase. */
export function pluginDataPoint(metric: PluginMetric): DataPoint {
  return {
    indexes: [metric.plugin],
    blobs: [
      metric.plugin,
      metric.phase,
      metric.outcome,
      metric.route ?? "",
      metric.pluginId,
    ],
    doubles: [metric.durationMs],
  };
}

/** Hourly requests, server errors and mean latency over the last `hours`. */
export const overviewSeriesSql = (hours: number) =>
  ANALYTICS.sql.series({
    dataset: REQUEST_DATASET,
    status: REQUEST_COLUMNS.status,
    durationMs: REQUEST_COLUMNS.duration_ms,
    hours,
  });

/** The busiest routes over the last `hours`. */
export const overviewRoutesSql = (hours: number, limit: number) =>
  ANALYTICS.sql.routes({
    dataset: REQUEST_DATASET,
    route: REQUEST_COLUMNS.route,
    status: REQUEST_COLUMNS.status,
    hours,
    limit,
  });

/** p50 and p99 request latency over the last `hours`. */
export const overviewLatencySql = (hours: number) =>
  ANALYTICS.sql.latency({
    dataset: REQUEST_DATASET,
    durationMs: REQUEST_COLUMNS.duration_ms,
    hours,
  });

/** The busiest consumers over the last `hours`. */
export const overviewConsumersSql = (hours: number, limit: number) =>
  ANALYTICS.sql.consumers({
    dataset: REQUEST_DATASET,
    consumer: REQUEST_COLUMNS.consumer,
    status: REQUEST_COLUMNS.status,
    hours,
    limit,
  });

/** A UUID, as Edgway's (and Kong's) entity ids are. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One consumer's requests and errors per day over the last `days` (the
 * portal's usage panel). The id goes into the query, so anything but
 * a UUID gets no query (undefined).
 */
export function consumerUsageSql(
  consumerId: string,
  days: number,
): string | undefined {
  if (!UUID.test(consumerId)) return undefined;
  return ANALYTICS.sql.consumerDaily({
    dataset: REQUEST_DATASET,
    consumer: REQUEST_COLUMNS.consumer,
    status: REQUEST_COLUMNS.status,
    consumerId,
    days,
  });
}
