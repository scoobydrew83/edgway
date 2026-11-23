import type { D1Migration } from "cloudflare:test";

declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database;
      ADMIN: Fetcher;
      TEST_MIGRATIONS: D1Migration[];
      TEST_ACCESS_KEY: string;
      ACCESS_TEAM: string;
      ACCESS_AUD: string;
    }
  }
}
