/** The data plane (@edgway/adapters-cf) over the bundled plugin registry. */
import {
  createDataPlane,
  createWorkerLoaderSandbox,
  type DataPlaneEnv,
  type HttpLogDelivery,
  type RateLimitCounter,
  writePluginMetric,
  writeRequestMetric,
} from "@edgway/adapters-cf";
import { contextStores } from "./context";
import * as registry from "./generated/plugins";

/** The data plane's bindings (config KV, public key, ConfigVersion), plus: */
export interface Env extends DataPlaneEnv {
  RATE_LIMIT_COUNTER: DurableObjectNamespace<RateLimitCounter>;
  /** Optional: http-log's retry buffer. */
  HTTP_LOG_RETRY?: Queue<HttpLogDelivery>;
  /** Optional: request metrics for the admin's overview dashboard. */
  ANALYTICS?: AnalyticsEngineDataset;
  /** Optional: per-plugin timing, one point per plugin per phase. */
  PLUGIN_ANALYTICS?: AnalyticsEngineDataset;
  /** Optional: Workers AI, for ai-proxy's models and fallback. */
  AI?: Ai;
  /** Optional: runs uploaded plugins in Dynamic Workers. */
  LOADER?: WorkerLoader;
}

// A service tag reaches only env bindings named UPSTREAM_*.
export const dataPlane = createDataPlane<Env>({
  plugins: Object.values(registry),
  setup: (snapshot, env) => contextStores(snapshot, env.RATE_LIMIT_COUNTER),
  observe: (c, request) => writeRequestMetric(c.env.ANALYTICS, request),
  observePlugin: (c, metric) =>
    writePluginMetric(c.env.PLUGIN_ANALYTICS, metric),
  sandbox: (plugins, env) =>
    env.LOADER && createWorkerLoaderSandbox({ loader: env.LOADER, plugins }),
});
