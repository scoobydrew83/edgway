import type { ConfigVersion, RateLimitCounter } from "../src/index";

declare global {
  namespace Cloudflare {
    interface Env {
      CONFIG_KV: KVNamespace;
      CONFIG_VERSION: DurableObjectNamespace<ConfigVersion>;
      RATE_LIMIT_COUNTER: DurableObjectNamespace<RateLimitCounter>;
      RATE_LIMIT: RateLimit;
      LOADER: WorkerLoader;
      CAPABILITY: Fetcher;
    }
  }
}
