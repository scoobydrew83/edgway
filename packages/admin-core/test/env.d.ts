import type { D1Migration } from "cloudflare:test";
import type { ConfigVersion } from "@edgway/adapters-cf";

declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database;
      CONFIG_KV: KVNamespace;
      CONFIG_VERSION: DurableObjectNamespace<ConfigVersion>;
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
