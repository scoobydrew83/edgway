/**
 * The stores, cache and transports the plugins read from the request context,
 * set before any plugin runs (built once per snapshot).
 */
import {
  aiTokenCounters,
  aiTransport,
  fetchTransport,
  type HttpLogDelivery,
  proxyCacheBackend,
  type RateLimitCounter,
  rateLimitStores,
  type Snapshot,
  snapshotStores,
} from "@edgway/adapters-cf";
import { setAclStore } from "@edgway/plugin-acl";
import { setAiTransport, setWorkersAi } from "@edgway/plugin-ai-proxy";
import { setAiTokenCounters } from "@edgway/plugin-ai-rate-limiting-advanced";
import { setBasicAuthStore } from "@edgway/plugin-basic-auth";
import { setHttpLogQueue, setHttpLogTransport } from "@edgway/plugin-http-log";
import { setJwtStore } from "@edgway/plugin-jwt";
import keyAuth, { setKeyAuthStore } from "@edgway/plugin-key-auth";
import { setOidcStore } from "@edgway/plugin-openid-connect";
import { setProxyCacheBackend } from "@edgway/plugin-proxy-cache";
import { setRateLimitStores } from "@edgway/plugin-rate-limiting";
import type { MiddlewareHandler } from "hono";

/** Every enabled key-auth's `key_names`, Kong's defaults applied. */
export const credentialParams = (snapshot: Snapshot) =>
  snapshot.plugins
    .filter((p) => p.name === keyAuth.name && p.enabled !== false)
    .flatMap((p) => keyAuth.parse(p.config).key_names ?? []);

export function contextStores(
  snapshot: Snapshot,
  counters: DurableObjectNamespace<RateLimitCounter>,
): MiddlewareHandler<{
  Bindings: { HTTP_LOG_RETRY?: Queue<HttpLogDelivery>; AI?: Ai };
}> {
  const stores = snapshotStores(snapshot);
  const limits = rateLimitStores(counters);
  const tokens = aiTokenCounters(counters);
  const keyNames = credentialParams(snapshot);
  return async (c, next) => {
    setKeyAuthStore(c, stores.keyAuth);
    setJwtStore(c, stores.jwt);
    setBasicAuthStore(c, stores.basicAuth);
    setOidcStore(c, stores.oidc);
    setAclStore(c, stores.acl);
    setRateLimitStores(c, limits);
    setAiTokenCounters(c, tokens);
    setAiTransport(c, aiTransport);
    if (c.env.AI) setWorkersAi(c, c.env.AI);
    const { cache } = c.executionCtx as ExecutionContext;
    setProxyCacheBackend(c, proxyCacheBackend(cache, keyNames));
    setHttpLogTransport(c, fetchTransport);
    const queue = c.env.HTTP_LOG_RETRY;
    if (queue) setHttpLogQueue(c, { send: (d) => queue.send(d).then() });
    await next();
  };
}
