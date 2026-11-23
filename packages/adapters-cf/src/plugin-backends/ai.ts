/**
 * The AI plugins' backends, structural so no plugin is imported:
 * ai-proxy's provider transport, and ai-rate-limiting-advanced's token
 * counters (one RateLimitCounter Durable Object per counter key, exact).
 */
import type { RateLimitCounter } from "../rate-limit/durable-object.js";

/** ai-proxy's transport for provider calls: the runtime's fetch. */
export const aiTransport: typeof fetch = (input, init) => fetch(input, init);

export function aiTokenCounters(
  namespace: DurableObjectNamespace<RateLimitCounter>,
  now: () => number = Date.now,
) {
  const counter = (key: string) => namespace.get(namespace.idFromName(key));
  return {
    async get(key: string, windowSeconds: number) {
      const at = now();
      const { count, resetAt } = await counter(key).tokens(windowSeconds, at);
      return {
        used: count,
        resetSeconds: Math.max(Math.ceil((resetAt - at) / 1000), 0),
      };
    },
    async add(key: string, windowSeconds: number, tokens: number) {
      await counter(key).addTokens(windowSeconds, tokens, now());
    },
  };
}
