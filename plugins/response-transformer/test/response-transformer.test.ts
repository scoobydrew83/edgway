import type { PluginInput } from "@edgway/plugin-sdk";
import { testApp } from "@edgway/plugin-sdk/testing";
import type { Handler } from "hono";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import transformer from "../src/index";

const upstreamJson =
  (body: unknown, headers: Record<string, string> = {}): Handler =>
  (c) => {
    for (const [k, v] of Object.entries(headers)) c.header(k, v);
    return c.json(body);
  };
const app = (
  config: PluginInput<typeof transformer.config>,
  upstream: Handler,
) => testApp(transformer, config, { upstream });

describe("response-transformer", () => {
  it("uses Kong's name and priority", () => {
    expect(transformer.name).toBe("response-transformer");
    expect(transformer.priority).toBe(800);
  });

  it("transforms response headers in Kong's order", async () => {
    const res = await app(
      {
        remove: { headers: ["x-drop"] },
        rename: { headers: ["x-old:x-new"] },
        replace: { headers: ["x-keep:replaced", "x-missing:no"] },
        add: { headers: ["x-keep:not-added", "x-added:yes"] },
        append: { headers: ["x-list:two"] },
      },
      upstreamJson(
        {},
        { "x-drop": "1", "x-old": "moved", "x-keep": "orig", "x-list": "one" },
      ),
    ).request("/");
    expect(res.headers.get("x-drop")).toBeNull();
    expect(res.headers.get("x-old")).toBeNull();
    expect(res.headers.get("x-missing")).toBeNull();
    expect(res.headers.get("x-new")).toBe("moved");
    expect(res.headers.get("x-keep")).toBe("replaced");
    expect(res.headers.get("x-added")).toBe("yes");
    expect(res.headers.get("x-list")).toBe("one, two");
  });

  it("transforms a JSON body with json_types", async () => {
    const res = await app(
      {
        remove: { json: ["secret"] },
        rename: { json: ["old:new"] },
        replace: { json: ["count:7"], json_types: ["number"] },
        add: {
          json: ["flag:true", "note:hi"],
          json_types: ["boolean", "string"],
        },
        append: { json: ["tags:c"] },
      },
      upstreamJson({ secret: "s", old: 1, count: 1, tags: ["a", "b"] }),
    ).request("/");
    expect(res.headers.get("content-length")).toBeNull();
    expect(await res.json()).toEqual({
      new: 1,
      count: 7,
      tags: ["a", "b", "c"],
      flag: true,
      note: "hi",
    });
  });

  it("keeps a non-numeric value as a string for json_types number", async () => {
    const res = await app(
      { add: { json: ["n:abc"], json_types: ["number"] } },
      upstreamJson({}),
    ).request("/");
    expect(await res.json()).toEqual({ n: "abc" });
  });

  it("leaves non-JSON, invalid JSON and oversized bodies untouched", async () => {
    const text = await app({ add: { json: ["x:1"] } }, (c) =>
      c.text("plain"),
    ).request("/");
    expect(await text.text()).toBe("plain");
    const invalid = await app({ add: { json: ["x:1"] } }, (c) =>
      c.body("{bad", 200, { "content-type": "application/json" }),
    ).request("/");
    expect(await invalid.text()).toBe("{bad");
    const big = { data: "x".repeat(1_100_000) };
    const large = await app(
      { add: { json: ["x:1"] } },
      upstreamJson(big),
    ).request("/");
    expect(await large.json()).toEqual(big);
  });

  it("is also plain Hono middleware", async () => {
    const plain = new Hono();
    plain.use(
      transformer.middleware({
        add: { json: ["added:1"], headers: ["x-a:1"] },
      }),
    );
    plain.get("/", (c) => c.json({ a: 1 }));
    const res = await plain.request("/");
    expect(res.headers.get("x-a")).toBe("1");
    expect(await res.json()).toEqual({ a: 1, added: "1" });
  });
});
