/**
 * rate-limiting's counter stores: one RateLimitCounter Durable Object store
 * per window, reused across requests (the plugin builds its limiters once per
 * store). Every policy counts exactly in the Durable Object: the Rate Limiting
 * binding's limit and period are fixed per binding in wrangler.jsonc, so it
 * can't serve per-route limits from the snapshot.
 */
import type { RateLimitStore } from "@edgway/core";
import {
  createDurableObjectStore,
  type RateLimitCounter,
} from "../rate-limit/durable-object.js";
import type { KongWindow } from "../rate-limit/windows.js";

export function rateLimitStores(
  namespace: DurableObjectNamespace<RateLimitCounter>,
): { store(window: KongWindow): RateLimitStore & { exact: boolean } } {
  const stores = new Map<KongWindow, RateLimitStore & { exact: boolean }>();
  return {
    store(window) {
      let store = stores.get(window);
      if (!store) {
        store = {
          ...createDurableObjectStore({ namespace, window }),
          exact: true,
        };
        stores.set(window, store);
      }
      return store;
    },
  };
}
