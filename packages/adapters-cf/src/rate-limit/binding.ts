/**
 * Kong's `policy: local` on the Cloudflare Rate Limiting binding: counters
 * per Cloudflare location, eventually consistent, like Kong's per-node local
 * counters. The binding's limit and period (10 or 60 s) are set in wrangler
 * config, and it answers only allow or deny, so hit counts are not exact.
 */
import type { RateLimitStore } from "@edgway/core";

/** Reported as the hit count when the binding denies: always over any limit. */
const OVER_LIMIT = Number.MAX_SAFE_INTEGER;

export function createBindingStore(
  binding: RateLimit,
): RateLimitStore & { exact: false } {
  return {
    exact: false,
    localKeys: false,
    async increment(key) {
      const { success } = await binding.limit({ key });
      return { totalHits: success ? 0 : OVER_LIMIT, resetTime: undefined };
    },
    // The binding keeps its own counters; nothing to undo or reset.
    async decrement() {},
    async resetKey() {},
  };
}
