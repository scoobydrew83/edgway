import type { D1Migration } from "cloudflare:test";
import type { Env as AdminEnv } from "../src/index";

declare global {
  namespace Cloudflare {
    interface GlobalProps {
      mainModule: typeof import("../src/index");
    }
    interface Env extends AdminEnv {
      TEST_MIGRATIONS: D1Migration[];
      TEST_ACCESS_KEY: string;
      /** The real gateway Worker (auxiliary), sharing CONFIG_KV. */
      GATEWAY: Fetcher;
    }
  }
}
