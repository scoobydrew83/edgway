import { env } from "cloudflare:test";
import { HTTP_LOG } from "@edgway/constants";
import { describe, expect, it, vi } from "vitest";
import {
  aiTokenCounters,
  fetchTransport,
  type HttpLogDelivery,
  proxyCacheBackend,
  rateLimitStores,
  retryDelaySeconds,
  retryHttpLog,
  snapshotStores,
} from "../src/index";

describe("snapshotStores", () => {
  const stores = snapshotStores({
    consumers: [
      { id: "c1", username: "alice", custom_id: "ext-1" },
      { id: "c2", username: null },
    ],
    keyauth_credentials: [{ id: "k1", consumer_id: "c1", key_hash: "abc" }],
    jwt_secrets: [{ id: "j1", consumer_id: "c1", key: "issuer-a" }],
    basicauth_credentials: [
      { id: "b1", consumer_id: "c2", username: "bob", password: "hash" },
    ],
    acls: [
      { consumer_id: "c1", group: "admins" },
      { consumer_id: "c1", group: "ops" },
    ],
    consumer_groups: [{ id: "g1", name: "gold" }],
    consumer_group_consumers: [{ consumer_group_id: "g1", consumer_id: "c1" }],
  });

  it("finds consumers by id, then username (Kong's anonymous lookup)", () => {
    expect(stores.keyAuth.consumer("c1")).toEqual({
      id: "c1",
      username: "alice",
      custom_id: "ext-1",
    });
    expect(stores.jwt.consumer("alice")?.id).toBe("c1");
    expect(stores.basicAuth.consumer("nobody")).toBeUndefined();
  });

  it("finds credentials by their lookup field", () => {
    expect(stores.keyAuth.credential("abc")?.consumer_id).toBe("c1");
    expect(stores.keyAuth.credential("zzz")).toBeUndefined();
    expect(stores.jwt.credential("issuer-a")?.id).toBe("j1");
    expect(stores.basicAuth.credential("bob")?.consumer_id).toBe("c2");
  });

  it("finds openid-connect consumers by Kong's consumer_by fields", () => {
    expect(stores.oidc.consumer("id", "c2")?.id).toBe("c2");
    expect(stores.oidc.consumer("username", "alice")?.id).toBe("c1");
    expect(stores.oidc.consumer("custom_id", "ext-1")?.id).toBe("c1");
    expect(stores.oidc.consumer("custom_id", "c1")).toBeUndefined();
  });

  it("lists acl groups and consumer-group names", () => {
    expect(stores.acl.groups("c1")).toEqual(["admins", "ops"]);
    expect(stores.acl.groups("c2")).toEqual([]);
    expect(stores.acl.consumerGroups("c1")).toEqual(["gold"]);
  });

  it("works with only consumers in the snapshot", () => {
    const empty = snapshotStores({ consumers: [] });
    expect(empty.keyAuth.credential("abc")).toBeUndefined();
    expect(empty.acl.groups("c1")).toEqual([]);
  });
});

describe("rateLimitStores", () => {
  it("reuses one exact Durable Object store per window", async () => {
    const stores = rateLimitStores(env.RATE_LIMIT_COUNTER);
    const minute = stores.store("minute");
    expect(stores.store("minute")).toBe(minute);
    expect(stores.store("hour")).not.toBe(minute);
    expect(minute.exact).toBe(true);
    const key = `rl-${Math.random()}`;
    await minute.increment(key);
    expect((await minute.increment(key)).totalHits).toBe(2);
    // Another window counts separately.
    expect((await stores.store("hour").increment(key)).totalHits).toBe(1);
  });
});

describe("aiTokenCounters", () => {
  it("adds tokens within a window and starts again in the next", async () => {
    let at = 60_000 * 16_666_667 + 20_000; // 20 s into a 60 s window
    const counters = aiTokenCounters(env.RATE_LIMIT_COUNTER, () => at);
    expect(await counters.get("ai-key", 60)).toEqual({
      used: 0,
      resetSeconds: 40,
    });
    await counters.add("ai-key", 60, 20);
    await counters.add("ai-key", 60, 15);
    expect(await counters.get("ai-key", 60)).toEqual({
      used: 35,
      resetSeconds: 40,
    });
    // Another key, and another window size, count apart.
    expect((await counters.get("other-key", 60)).used).toBe(0);
    expect((await counters.get("ai-key", 3600)).used).toBe(0);
    at += 60_000;
    expect((await counters.get("ai-key", 60)).used).toBe(0);
  });
});

describe("proxyCacheBackend", () => {
  it("pairs the cache store with the Kong cache key, minus query credentials", async () => {
    const backend = proxyCacheBackend(undefined, ["apikey"]);
    expect(backend.credentialParams).toEqual(["apikey"]);
    const key = await backend.key({
      url: "https://gw.test/a?apikey=secret&x=1",
      method: "GET",
      ignoreQuery: backend.credentialParams,
    });
    expect(key).not.toContain("secret");
    await backend.store.put(key, new Response("cached"), { ttlSeconds: 60 });
    expect(await (await backend.store.match(key))?.text()).toBe("cached");
  });
});

const delivery = (endpoint: string): HttpLogDelivery => ({
  endpoint,
  method: "POST",
  headers: { "content-type": "application/json", "x-test-status": "503" },
  body: "{}",
});

describe("http-log delivery", () => {
  it("fetchTransport resolves to whether the endpoint answered 2xx", async () => {
    expect(
      await fetchTransport.deliver(delivery("https://logs.test/in"), 1000),
    ).toBe(true);
    expect(
      await fetchTransport.deliver(delivery("https://down.internal/in"), 1000),
    ).toBe(false);
  });

  it("backs off exponentially, capped", () => {
    expect(retryDelaySeconds(1)).toBe(HTTP_LOG.retryBaseDelaySeconds);
    expect(retryDelaySeconds(2)).toBe(HTTP_LOG.retryBaseDelaySeconds * 2);
    expect(retryDelaySeconds(50)).toBe(HTTP_LOG.retryMaxDelaySeconds);
  });

  it("the queue consumer acks deliveries and retries failures", async () => {
    const message = (body: HttpLogDelivery, attempts: number) => ({
      id: String(attempts),
      timestamp: new Date(),
      body,
      attempts,
      ack: vi.fn(),
      retry: vi.fn(),
    });
    const ok = message(delivery("https://logs.test/in"), 1);
    const down = message(delivery("https://down.internal/in"), 3);
    const thrown = message(delivery("https://logs.test/in"), 1);
    const transport = {
      deliver: vi.fn(async (d: HttpLogDelivery, timeoutMs: number) => {
        expect(timeoutMs).toBe(HTTP_LOG.retryTimeoutMs);
        if (d === thrown.body) throw new Error("timed out");
        return fetchTransport.deliver(d, timeoutMs);
      }),
    };
    await retryHttpLog(
      {
        messages: [ok, down, thrown],
      } as unknown as MessageBatch<HttpLogDelivery>,
      transport,
    );
    expect(ok.ack).toHaveBeenCalledOnce();
    expect(ok.retry).not.toHaveBeenCalled();
    expect(down.retry).toHaveBeenCalledWith({
      delaySeconds: retryDelaySeconds(3),
    });
    expect(thrown.retry).toHaveBeenCalledWith({
      delaySeconds: retryDelaySeconds(1),
    });
  });
});
