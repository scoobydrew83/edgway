import type { D1Migration } from "cloudflare:test";
import type { Env as PortalEnv } from "../src/worker";

declare global {
  namespace Cloudflare {
    interface GlobalProps {
      mainModule: typeof import("../src/worker");
    }
    interface Env extends PortalEnv {
      TEST_MIGRATIONS: D1Migration[];
      TEST_IDP_KEY: string;
      TEST_PUBLIC_KEY: string;
      /** The config KV the admin publishes to (tests read what's live). */
      CONFIG_KV: KVNamespace;
    }
  }
}
