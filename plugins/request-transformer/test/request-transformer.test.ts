import { getRoute, type PluginInstance } from "@edgway/core";
import { ERR } from "@edgway/errors";
import type { PluginInput } from "@edgway/plugin-sdk";
import { testApp } from "@edgway/plugin-sdk/testing";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import transformer from "../src/index";

type Echo = {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string;
};
const run = async (
  config: PluginInput<typeof transformer.config>,
  path: string,
  init?: RequestInit,
) => {
  const res = await testApp(transformer, config).request(path, init);
  return (await res.json()) as Echo;
};
const json = (
  body: unknown,
  headers: Record<string, string> = {},
): RequestInit => ({
  method: "POST",
  body: JSON.stringify(body),
  headers: { "content-type": "application/json", ...headers },
});

describe("request-transformer", () => {
  it("uses Kong's name and priority", () => {
    expect(transformer.name).toBe("request-transformer");
    expect(transformer.priority).toBe(801);
  });

  it("transforms headers in Kong's order: remove, rename, replace, add, append", async () => {
    const echo = await run(
      {
        remove: { headers: ["x-drop"] },
        rename: { headers: ["x-old:x-new"] },
        replace: { headers: ["x-keep:replaced", "x-missing:ignored"] },
        add: { headers: ["x-keep:not-added", "x-added:yes"] },
        append: { headers: ["x-list:two"] },
      },
      "/",
      {
        headers: {
          "x-drop": "1",
          "x-old": "moved",
          "x-keep": "orig",
          "x-list": "one",
        },
      },
    );
    expect(echo.headers).not.toHaveProperty("x-drop");
    expect(echo.headers).not.toHaveProperty("x-old");
    expect(echo.headers).not.toHaveProperty("x-missing");
    expect(echo.headers).toMatchObject({
      "x-new": "moved",
      "x-keep": "replaced",
      "x-added": "yes",
      "x-list": "one, two",
    });
  });

  it("transforms the querystring", async () => {
    const echo = await run(
      {
        remove: { querystring: ["drop"] },
        rename: { querystring: ["old:new"] },
        replace: { querystring: ["keep:2"] },
        add: { querystring: ["added:yes"] },
        append: { querystring: ["list:b"] },
      },
      "/p?drop=1&old=x&keep=1&list=a",
    );
    const q = new URL(echo.url).searchParams;
    expect(q.has("drop")).toBe(false);
    expect(q.get("new")).toBe("x");
    expect(q.get("keep")).toBe("2");
    expect(q.get("added")).toBe("yes");
    expect(q.getAll("list")).toEqual(["a", "b"]);
  });

  it("renders Kong's templates from headers and query params", async () => {
    const echo = await run(
      {
        add: {
          headers: [
            "x-from-header:$(headers.x-in)",
            "x-from-query:$(query_params['q'])",
          ],
        },
      },
      "/?q=found",
      { headers: { "x-in": "hello" } },
    );
    expect(echo.headers).toMatchObject({
      "x-from-header": "hello",
      "x-from-query": "found",
    });
  });

  it("refuses a templated header value a header can't hold, with a 400", async () => {
    const res = await testApp(transformer, {
      add: { headers: ["x-from-query:$(query_params.q)"] },
    }).request("/?q=a%0Ab");
    expect(res.status).toBe(ERR.REQUEST_HEADER_INVALID.status);
    expect(await res.json()).toMatchObject({
      code: ERR.REQUEST_HEADER_INVALID.code,
    });
  });

  it("transforms a JSON body's top-level keys", async () => {
    const echo = await run(
      {
        remove: { body: ["secret"] },
        rename: { body: ["old:new"] },
        replace: { body: ["keep:replaced"] },
        add: { body: ["added:yes", "keep:no"] },
        append: { body: ["list:c", "single:two"] },
      },
      "/",
      json({
        secret: 1,
        old: "x",
        keep: "orig",
        list: ["a", "b"],
        single: "one",
      }),
    );
    expect(JSON.parse(echo.body)).toEqual({
      new: "x",
      keep: "replaced",
      list: ["a", "b", "c"],
      single: ["one", "two"],
      added: "yes",
    });
    expect(echo.headers).not.toHaveProperty("content-length");
  });

  it("transforms a form-urlencoded body", async () => {
    const echo = await run(
      { add: { body: ["b:2"] }, remove: { body: ["c"] } },
      "/",
      {
        method: "POST",
        body: "a=1&c=3",
        headers: { "content-type": "application/x-www-form-urlencoded" },
      },
    );
    expect(echo.body).toBe("a=1&b=2");
  });

  it("refuses a body it can't edit, never passing it on as it came", async () => {
    const t = testApp(transformer, { remove: { body: ["password"] } });
    const refused = async (init: RequestInit) => {
      const res = await t.request("/", init);
      expect(res.status).toBe(ERR.REQUEST_BODY_UNTRANSFORMABLE.status);
      expect(await res.json()).toMatchObject({
        code: ERR.REQUEST_BODY_UNTRANSFORMABLE.code,
      });
    };
    const leak = JSON.stringify({ password: "hunter2" });
    // Another content type, invalid JSON, and a JSON array.
    await refused({
      method: "POST",
      body: leak,
      headers: { "content-type": "text/plain" },
    });
    await refused({
      method: "POST",
      body: "{not json",
      headers: { "content-type": "application/json" },
    });
    await refused(json([{ password: "hunter2" }]));
    // Too large to edit, with or without a Content-Length.
    const big = { password: "hunter2", data: "x".repeat(1_100_000) };
    await refused(json(big));
    await refused({
      method: "POST",
      body: new Blob([JSON.stringify(big)]).stream(),
      headers: { "content-type": "application/json" },
      duplex: "half",
    } as RequestInit);
    expect(t.upstreamCalls).toHaveLength(0);
    // An ordinary JSON object is edited.
    const echo = await run(
      { remove: { body: ["password"] } },
      "/",
      json({
        password: "hunter2",
        user: "a",
      }),
    );
    expect(JSON.parse(echo.body)).toEqual({ user: "a" });
  });

  it("replaces the URI", async () => {
    const echo = await run({ replace: { uri: "/v2/items" } }, "/v1/items?x=1");
    expect(new URL(echo.url).pathname).toBe("/v2/items");
    expect(new URL(echo.url).search).toBe("?x=1");
  });

  it("changes the method, moving a form body into the query for GET", async () => {
    const put = await run({ http_method: "PUT" }, "/", json({ a: 1 }));
    expect(put.method).toBe("PUT");
    expect(JSON.parse(put.body)).toEqual({ a: 1 });
    const get = await run({ http_method: "GET" }, "/?x=1", {
      method: "POST",
      body: "a=1&b=2",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "content-length": "7",
      },
    });
    expect(get.method).toBe("GET");
    expect(new URL(get.url).search).toBe("?x=1&a=1&b=2");
    expect(get.body).toBe("");
  });

  describe("through the gateway's route match", () => {
    /** Stands in for the gateway's router: a route match on the context. */
    const matched: PluginInstance = {
      id: "router",
      name: "router",
      priority: Number.MAX_SAFE_INTEGER,
      scope: {},
      handlers: {
        access: async (c, next) => {
          c.set("edgwayRoute", {
            route: { id: "r1" },
            upstreamPath: "/up/path?keep=1",
            captures: { groups: ["g1"], named: { id: "42" } },
          });
          await next();
        },
      },
    };
    const viaGateway = async (
      config: PluginInput<typeof transformer.config>,
      path = "/in?keep=1",
    ) => {
      const t = testApp(transformer, config, {
        plugins: [matched],
        upstream: (c) =>
          c.json({
            upstreamPath: getRoute(c)?.upstreamPath,
            headers: Object.fromEntries(c.req.raw.headers),
          }),
      });
      return (await (await t.request(path)).json()) as {
        upstreamPath: string;
        headers: Record<string, string>;
      };
    };

    it("sends querystring changes upstream", async () => {
      const res = await viaGateway({
        add: { querystring: ["added:yes"] },
        remove: { querystring: ["keep"] },
      });
      expect(res.upstreamPath).toBe("/up/path?added=yes");
    });

    it("replaces the upstream path with replace.uri, keeping the query", async () => {
      const res = await viaGateway({
        replace: { uri: "/v2/$(uri_captures.id)" },
      });
      expect(res.upstreamPath).toBe("/v2/42?keep=1");
    });

    it("renders named and numbered uri_captures", async () => {
      const res = await viaGateway({
        add: {
          headers: [
            "x-named:$(uri_captures.id)",
            "x-numbered:$(uri_captures[1])",
          ],
        },
      });
      expect(res.headers).toMatchObject({
        "x-named": "42",
        "x-numbered": "g1",
      });
    });
  });

  it("is also plain Hono middleware", async () => {
    const plain = new Hono();
    plain.use(transformer.middleware({ add: { headers: ["x-added:1"] } }));
    plain.get("/", (c) => c.text(c.req.header("x-added") ?? ""));
    expect(await (await plain.request("/")).text()).toBe("1");
  });
});
