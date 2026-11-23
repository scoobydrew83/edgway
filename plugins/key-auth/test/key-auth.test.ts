import { API_KEY } from "@edgway/constants";
import { type PluginInstance, sha256Hex } from "@edgway/core";
import { errorHandler } from "@edgway/errors";
import type { PluginInput } from "@edgway/plugin-sdk";
import { testApp } from "@edgway/plugin-sdk/testing";
import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import keyAuth, {
  generateKey,
  type KeyAuthCredential,
  type KeyAuthStore,
  keyDisplayPrefix,
  setKeyAuthStore,
} from "../src/index";

const consumers = [
  { id: "c-alice", username: "alice", custom_id: "cust-1" },
  { id: "c-anon", username: "anonymous" },
];
const credentials = new Map<string, KeyAuthCredential>();

const store: KeyAuthStore = {
  credential: (hash) => credentials.get(hash),
  consumer: (idOrUsername) =>
    consumers.find((c) => c.id === idOrUsername || c.username === idOrUsername),
};

beforeAll(async () => {
  credentials.set(await sha256Hex("alice-key"), {
    id: "cred-1",
    consumer_id: "c-alice",
  });
  credentials.set(await sha256Hex("old-key"), {
    id: "cred-2",
    consumer_id: "c-alice",
    expires_at: Math.floor(Date.now() / 1000) - 60,
  });
});

/** The gateway's part: put the snapshot's credentials on the context first. */
const withStore: PluginInstance = {
  id: "store",
  name: "store",
  priority: Number.MAX_SAFE_INTEGER,
  scope: {},
  handlers: {
    access: async (c, next) => {
      setKeyAuthStore(c, store);
      await next();
    },
  },
};

const app = (config: PluginInput<typeof keyAuth.config> = {}) =>
  testApp(keyAuth, config, { plugins: [withStore] });

type Echo = { url: string; headers: Record<string, string> };

describe("key-auth", () => {
  it("uses Kong's name, priority and defaults", () => {
    expect(keyAuth.name).toBe("key-auth");
    expect(keyAuth.priority).toBe(1250);
    expect(keyAuth.parse({})).toMatchObject({
      key_names: ["apikey"],
      key_in_header: true,
      key_in_query: true,
      hide_credentials: false,
      run_on_preflight: true,
    });
  });

  it("authenticates a key in a header and sets Kong's consumer headers", async () => {
    const res = await app().request("/", {
      headers: { apikey: "alice-key", "x-anonymous-consumer": "true" },
    });
    expect(res.status).toBe(200);
    const echo = (await res.json()) as Echo;
    expect(echo.headers).toMatchObject({
      "x-consumer-id": "c-alice",
      "x-consumer-username": "alice",
      "x-consumer-custom-id": "cust-1",
      "x-credential-identifier": "cred-1",
      apikey: "alice-key",
    });
    expect(echo.headers).not.toHaveProperty("x-anonymous-consumer");
  });

  it("authenticates a key in the query string", async () => {
    const res = await app().request("/?apikey=alice-key&x=1");
    expect(res.status).toBe(200);
    const echo = (await res.json()) as Echo;
    expect(echo.url).toContain("apikey=alice-key");
    expect(echo.headers["x-consumer-id"]).toBe("c-alice");
  });

  it("tries each key name in order", async () => {
    const res = await app({ key_names: ["x-first", "x-second"] }).request("/", {
      headers: { "x-second": "alice-key" },
    });
    expect(res.status).toBe(200);
  });

  it("answers a missing key with Kong's 401 and WWW-Authenticate", async () => {
    const t = app();
    const res = await t.request("/");
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe("Key");
    expect(await res.json()).toMatchObject({
      code: "EDG-AUTH-002",
      title: "No API key found in request",
    });
    expect(t.upstreamCalls).toHaveLength(0);
    expect(t.events.find((e) => e.plugin.name === "key-auth")?.outcome).toBe(
      "short-circuit",
    );
  });

  it("names the realm in the challenge", async () => {
    const res = await app({ realm: "edgway" }).request("/");
    expect(res.headers.get("www-authenticate")).toBe('Key realm="edgway"');
  });

  it("rejects an unknown key as Unauthorized", async () => {
    const res = await app().request("/", { headers: { apikey: "nope" } });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({
      code: "EDG-AUTH-004",
      title: "Unauthorized",
    });
  });

  it("rejects a key bearer-auth considers malformed as Unauthorized, not 400", async () => {
    const res = await app().request("/", { headers: { apikey: "a key" } });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "EDG-AUTH-004" });
  });

  it("rejects an expired key (credential ttl)", async () => {
    const res = await app().request("/", { headers: { apikey: "old-key" } });
    expect(res.status).toBe(401);
  });

  it("rejects duplicate keys in the query string", async () => {
    const res = await app().request("/?apikey=alice-key&apikey=other");
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "EDG-AUTH-003" });
  });

  it("ignores header keys when key_in_header is false", async () => {
    const t = app({ key_in_header: false });
    const res = await t.request("/", { headers: { apikey: "alice-key" } });
    expect(res.status).toBe(401);
    expect((await t.request("/?apikey=alice-key")).status).toBe(200);
  });

  it("ignores query keys when key_in_query is false", async () => {
    const res = await app({ key_in_query: false }).request(
      "/?apikey=alice-key",
    );
    expect(res.status).toBe(401);
  });

  it("hides the credential from the upstream with hide_credentials", async () => {
    const t = app({ hide_credentials: true });
    const header = (await (
      await t.request("/", { headers: { apikey: "alice-key" } })
    ).json()) as Echo;
    expect(header.headers).not.toHaveProperty("apikey");
    expect(header.headers["x-consumer-id"]).toBe("c-alice");
    const query = (await (
      await t.request("/p?apikey=alice-key&keep=1")
    ).json()) as Echo;
    expect(query.url).toBe("https://gateway.test/p?keep=1");
  });

  it("falls back to the anonymous consumer (by id or username)", async () => {
    for (const anonymous of ["c-anon", "anonymous"]) {
      const t = app({ anonymous });
      for (const init of [{}, { headers: { apikey: "nope" } }]) {
        const res = await t.request("/", init);
        expect(res.status).toBe(200);
        const echo = (await res.json()) as Echo;
        expect(echo.headers).toMatchObject({
          "x-consumer-id": "c-anon",
          "x-anonymous-consumer": "true",
        });
        expect(echo.headers).not.toHaveProperty("x-credential-identifier");
      }
    }
  });

  it("fails with 500 when the anonymous consumer does not exist", async () => {
    const res = await app({ anonymous: "ghost" }).request("/");
    expect(res.status).toBe(500);
  });

  it("lets OPTIONS through without a key when run_on_preflight is false", async () => {
    const off = await app({ run_on_preflight: false }).request("/", {
      method: "OPTIONS",
    });
    expect(off.status).toBe(200);
    const on = await app().request("/", { method: "OPTIONS" });
    expect(on.status).toBe(401);
  });

  it("fails closed without a credential store", async () => {
    const t = testApp(keyAuth, {});
    const res = await t.request("/", { headers: { apikey: "alice-key" } });
    expect(res.status).toBe(500);
  });

  it("is also plain Hono middleware", async () => {
    const plain = new Hono();
    plain.onError(errorHandler({ format: "kong" }));
    plain.use(async (c, next) => {
      setKeyAuthStore(c, store);
      await next();
    });
    plain.use(keyAuth.middleware({ key_names: ["x-key"] }));
    plain.get("/", (c) => c.text("ok"));
    expect(
      await (
        await plain.request("/", { headers: { "x-key": "alice-key" } })
      ).text(),
    ).toBe("ok");
    const denied = await plain.request("/");
    expect(denied.status).toBe(401);
    expect(denied.headers.get("www-authenticate")).toBe("Key");
  });
});

describe("key generation", () => {
  it("generates prefixed nanoid keys and a display prefix", () => {
    const key = generateKey();
    expect(key.startsWith(API_KEY.prefix)).toBe(true);
    expect(key).toHaveLength(API_KEY.prefix.length + API_KEY.randomChars);
    expect(key).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(generateKey()).not.toBe(key);
    expect(keyDisplayPrefix(key)).toBe(
      key.slice(0, API_KEY.displayPrefixLength),
    );
  });
});
