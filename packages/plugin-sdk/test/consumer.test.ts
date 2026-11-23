import { getConsumer } from "@edgway/core";
import { errorHandler } from "@edgway/errors";
import { Hono, type MiddlewareHandler } from "hono";
import { describe, expect, it } from "vitest";
import {
  authenticated,
  identifyAnonymous,
  identifyConsumer,
} from "../src/index";

const alice = { id: "c-alice", username: "alice", custom_id: "cust-1" };

/** Runs `fn`, then echoes what the upstream would see. */
function app(fn: MiddlewareHandler) {
  const a = new Hono();
  a.onError(errorHandler());
  a.use(fn);
  a.all("*", (c) =>
    c.json({
      url: c.req.url,
      headers: Object.fromEntries(c.req.raw.headers),
      consumer: getConsumer(c),
    }),
  );
  return a;
}

type Echo = {
  url: string;
  headers: Record<string, string>;
  consumer?: { id: string };
};

describe("identifyConsumer", () => {
  it("sets the consumer and Kong's upstream consumer headers", async () => {
    const res = await app(async (c, next) => {
      identifyConsumer(c, alice, { credential: "cred-1" });
      await next();
    }).request("/", {
      headers: { "x-anonymous-consumer": "true", "x-consumer-id": "spoof" },
    });
    const echo = (await res.json()) as Echo;
    expect(echo.consumer).toEqual({ id: "c-alice" });
    expect(echo.headers).toMatchObject({
      "x-consumer-id": "c-alice",
      "x-consumer-username": "alice",
      "x-consumer-custom-id": "cust-1",
      "x-credential-identifier": "cred-1",
    });
    expect(echo.headers).not.toHaveProperty("x-anonymous-consumer");
  });

  it("marks a consumer without a credential as anonymous and drops absent fields", async () => {
    const res = await app(async (c, next) => {
      identifyConsumer(c, { id: "c-anon" });
      await next();
    }).request("/", {
      headers: {
        "x-consumer-username": "spoof",
        "x-credential-identifier": "x",
      },
    });
    const echo = (await res.json()) as Echo;
    expect(echo.headers["x-anonymous-consumer"]).toBe("true");
    expect(echo.headers).not.toHaveProperty("x-consumer-username");
    expect(echo.headers).not.toHaveProperty("x-credential-identifier");
  });

  it("removes credential headers and query parameters", async () => {
    const res = await app(async (c, next) => {
      identifyConsumer(c, alice, {
        credential: "cred-1",
        removeHeaders: ["authorization"],
        removeQuery: ["apikey"],
      });
      await next();
    }).request("/p?apikey=k&keep=1", {
      method: "POST",
      headers: { authorization: "secret" },
      body: "payload",
    });
    const echo = (await res.json()) as Echo;
    expect(echo.url).toBe("http://localhost/p?keep=1");
    expect(echo.headers).not.toHaveProperty("authorization");
  });
});

describe("identifyAnonymous", () => {
  const lookup = (idOrUsername: string) =>
    [alice].find((c) => c.id === idOrUsername || c.username === idOrUsername);

  it("identifies the anonymous consumer by id or username", async () => {
    for (const ref of ["c-alice", "alice"]) {
      const res = await app(async (c, next) => {
        await identifyAnonymous(c, lookup, ref);
        await next();
      }).request("/");
      const echo = (await res.json()) as Echo;
      expect(echo.headers["x-consumer-id"]).toBe("c-alice");
      expect(echo.headers["x-anonymous-consumer"]).toBe("true");
    }
  });

  it("fails with 500 when the anonymous consumer does not exist", async () => {
    const res = await app(async (c, next) => {
      await identifyAnonymous(c, lookup, "ghost");
      await next();
    }).request("/");
    expect(res.status).toBe(500);
  });
});

describe("authenticated (Kong's logical OR)", () => {
  const check = (fn: MiddlewareHandler) => {
    const a = new Hono();
    a.use(fn);
    a.all("*", (c) => c.json({ authenticated: authenticated(c) }));
    return a;
  };

  it("is true only for a consumer identified with a credential", async () => {
    const none = await check(async (_c, next) => next()).request("/");
    expect(await none.json()).toEqual({ authenticated: false });
    const real = await check(async (c, next) => {
      identifyConsumer(c, alice, { credential: "cred-1" });
      await next();
    }).request("/");
    expect(await real.json()).toEqual({ authenticated: true });
    const anon = await check(async (c, next) => {
      identifyConsumer(c, alice);
      await next();
    }).request("/");
    expect(await anon.json()).toEqual({ authenticated: false });
  });
});
