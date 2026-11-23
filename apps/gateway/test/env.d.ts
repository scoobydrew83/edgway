import type { ConfigVersion } from "@edgway/adapters-cf";
import type { Env as GatewayEnv } from "../src/data-plane";

declare global {
  namespace Cloudflare {
    interface GlobalProps {
      mainModule: typeof import("../src/index");
    }
    interface Env extends GatewayEnv {
      TEST_SNAPSHOT: string;
      TEST_SNAPSHOT_SHA256: string;
      TEST_SIGNING_KEY: string;
      TEST_IDP_KEY: string;
      TEST_IDP_ISSUER: string;
      /** The stand-in admin's ConfigVersion DO, for the test setup. */
      TEST_CONFIG_VERSION?: DurableObjectNamespace<ConfigVersion>;
    }
  }
}
