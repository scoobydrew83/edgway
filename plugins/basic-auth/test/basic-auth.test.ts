import type { PluginInstance } from "@edgway/core";
import { errorHandler } from "@edgway/errors";
import type { PluginInput } from "@edgway/plugin-sdk";
import { testApp } from "@edgway/plugin-sdk/testing";
import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import basicAuth, {
  type BasicAuthCredential,
  type BasicAuthStore,
  hashPassword,
  setBasicAuthStore,
} from "../src/index";

const consumers = [
  { id: "c-alice", username: "alice", custom_id: "cust-1" },
  { id: "c-anon", username: "anonymous" },
];
const credentials: BasicAuthCredential[] = [];
const store: BasicAuthStore = {
  credential: (username) => credentials.find((c) => c.username === username),
  consumer: (idOrUsername) =>
    consumers.find((c) => c.id === idOrUsername || c.username === idOrUsername),
};

beforeAll(async () => {
  credentials.push(
    {
      id: "cred-1",
      consumer_id: "c-alice",
      username: "alice-user",
      password: await hashPassword("s3cret", "c-alice"),
    },
    {
      id: "cred-orphan",
      consumer_id: "c-gone",
      username: "orphan",
      password: await hashPassword("pw", "c-gone"),
    },
  );
});

const withStore: PluginInstance = {
  id: "store",
  name: "store",
  priority: Number.MAX_SAFE_INTEGER,
  scope: {},
  handlers: {
    access: async (c, next) => {
      setBasicAuthStore(c, store);
      await next();
    },
  },
};

const app = (config: PluginInput<typeof basicAuth.config> = {}) =>
  testApp(basicAuth, config, { plugins: [withStore] });
const basic = (user: string, password: string) =>
  `Basic ${btoa(`${user}:${password}`)}`;
type Echo = { headers: Record<string, string> };

async function expectUnauthorized(res: Response, realm = "service") {
  expect(res.status).toBe(401);
  expect(res.headers.get("www-authenticate")).toBe(`Basic realm="${realm}"`);
  expect(await res.json()).toMatchObject({
    code: "EDG-AUTH-004",
    title: "Unauthorized",
  });
}

describe("basic-auth", () => {
  it("uses Kong's name, priority and defaults", () => {
    expect(basicAuth.name).toBe("basic-auth");
    expect(basicAuth.priority).toBe(1100);
    expect(basicAuth.parse({})).toMatchObject({
      hide_credentials: false,
      realm: "service",
    });
  });

  it("checks passwords in Kong's stored format, sha1(password .. consumer_id)", async () => {
    // printf 'pwc1' | sha1sum
    expect(await hashPassword("pw", "c1")).toBe(
      "3e6bf39549a461d177c2dac97e77db0056f63224",
    );
    expect(await hashPassword("password", "")).toBe(
      "5baa61e4c9b93f3f0682250b6cf8331b7ee68fd8",
    );
  });

  it("authenticates Authorization and sets Kong's consumer headers", async () => {
    const res = await app().request("/", {
      headers: { authorization: basic("alice-user", "s3cret") },
    });
    expect(res.status).toBe(200);
    const echo = (await res.json()) as Echo;
    expect(echo.headers).toMatchObject({
      "x-consumer-id": "c-alice",
      "x-consumer-username": "alice",
      "x-consumer-custom-id": "cust-1",
      "x-credential-identifier": "alice-user",
    });
    expect(echo.headers).toHaveProperty("authorization");
    expect(echo.headers).not.toHaveProperty("x-anonymous-consumer");
  });

  it("authenticates Proxy-Authorization, which Kong reads first", async () => {
    const proxy = await app().request("/", {
      headers: { "proxy-authorization": basic("alice-user", "s3cret") },
    });
    expect(proxy.status).toBe(200);
    const both = await app().request("/", {
      headers: {
        "proxy-authorization": basic("alice-user", "wrong"),
        authorization: basic("alice-user", "s3cret"),
      },
    });
    await expectUnauthorized(both);
    const unknownProxy = await app().request("/", {
      headers: {
        "proxy-authorization": basic("nobody", "x"),
        authorization: basic("alice-user", "s3cret"),
      },
    });
    expect(unknownProxy.status).toBe(200);
  });

  it("answers missing credentials with 401 and the realm challenge", async () => {
    const t = app();
    await expectUnauthorized(await t.request("/"));
    expect(t.upstreamCalls).toHaveLength(0);
    await expectUnauthorized(
      await app({ realm: "edgway" }).request("/"),
      "edgway",
    );
  });

  it("rejects a wrong password, an unknown user and a malformed header", async () => {
    for (const authorization of [
      basic("alice-user", "wrong"),
      basic("nobody", "s3cret"),
      "Basic !!!",
      "Bearer token",
    ]) {
      await expectUnauthorized(
        await app().request("/", { headers: { authorization } }),
      );
    }
  });

  it("strips both headers upstream with hide_credentials", async () => {
    const res = await app({ hide_credentials: true }).request("/", {
      headers: {
        authorization: basic("alice-user", "s3cret"),
        "proxy-authorization": basic("nobody", "x"),
      },
    });
    expect(res.status).toBe(200);
    const echo = (await res.json()) as Echo;
    expect(echo.headers).not.toHaveProperty("authorization");
    expect(echo.headers).not.toHaveProperty("proxy-authorization");
  });

  it("falls back to the anonymous consumer", async () => {
    const t = app({ anonymous: "anonymous" });
    for (const headers of [
      {},
      { authorization: basic("alice-user", "no") },
    ] as Record<string, string>[]) {
      const res = await t.request("/", { headers });
      expect(res.status).toBe(200);
      expect(((await res.json()) as Echo).headers).toMatchObject({
        "x-consumer-id": "c-anon",
        "x-anonymous-consumer": "true",
      });
    }
    expect((await app({ anonymous: "ghost" }).request("/")).status).toBe(500);
  });

  it("fails with 500 when a credential's consumer is missing", async () => {
    const res = await app().request("/", {
      headers: { authorization: basic("orphan", "pw") },
    });
    expect(res.status).toBe(500);
  });

  it("fails closed without a credential store", async () => {
    const res = await testApp(basicAuth, {}).request("/", {
      headers: { authorization: basic("alice-user", "s3cret") },
    });
    expect(res.status).toBe(500);
  });

  it("is also plain Hono middleware", async () => {
    const plain = new Hono();
    plain.onError(errorHandler());
    plain.use(async (c, next) => {
      setBasicAuthStore(c, store);
      await next();
    });
    plain.use(basicAuth.middleware({}));
    plain.get("/", (c) => c.text("ok"));
    const ok = await plain.request("/", {
      headers: { authorization: basic("alice-user", "s3cret") },
    });
    expect(await ok.text()).toBe("ok");
    await expectUnauthorized(await plain.request("/"));
  });
});
