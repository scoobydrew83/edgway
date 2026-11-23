/**
 * Request metrics on Workers Analytics Engine (PRD "Telemetry"): the gateway
 * writes one data point per request through its binding, and the admin reads
 * them back through Cloudflare's SQL API. The dataset layout and the queries
 * are @edgway/telemetry's.
 */
import { ANALYTICS, AUTHORIZATION, HEADER } from "@edgway/constants";
import { ERR, fail } from "@edgway/errors";
import {
  type PluginMetric,
  pluginDataPoint,
  type RequestMetric,
  requestDataPoint,
} from "@edgway/telemetry";

/** Writes a request's data point; a gateway without the binding writes nothing. */
export function writeRequestMetric(
  dataset: AnalyticsEngineDataset | undefined,
  metric: RequestMetric,
): void {
  dataset?.writeDataPoint(requestDataPoint(metric));
}

/** Writes one plugin's timing; without the binding, nothing. */
export function writePluginMetric(
  dataset: AnalyticsEngineDataset | undefined,
  metric: PluginMetric,
): void {
  dataset?.writeDataPoint(pluginDataPoint(metric));
}

export interface AnalyticsSqlOptions {
  accountId: string;
  /** An API token with Account Analytics read (a Worker secret). */
  apiToken: string;
  fetch?: typeof fetch;
}

/** Runs a query on the SQL API; returns its rows. */
export function analyticsSql(options: AnalyticsSqlOptions) {
  const send = options.fetch ?? fetch;
  return async <Row>(sql: string): Promise<Row[]> => {
    const res = await send(ANALYTICS.sqlApi(options.accountId), {
      method: "POST",
      headers: {
        [HEADER.authorization]: AUTHORIZATION.bearer(options.apiToken),
      },
      body: sql,
    });
    if (!res.ok)
      fail(ERR.ADMIN_ANALYTICS_FAILED, { detail: String(res.status) });
    return ((await res.json()) as { data: Row[] }).data;
  };
}
