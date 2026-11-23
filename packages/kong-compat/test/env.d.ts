import type { D1Migration } from "cloudflare:test";

declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database;
      CONFIG_KV: KVNamespace;
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
