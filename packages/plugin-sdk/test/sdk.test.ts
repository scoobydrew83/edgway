import { kongSchema } from "@edgway/schema";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { definePlugin } from "../src/index";
import { echoUpstream, testApp, withContext } from "../src/testing";

/** An Edgway-only example plugin: its schema is zod (PRD "Schemas"). */
const addHeader = definePlugin({
  name: "add-header",
  version: "1.0.0",
  priority: 800,
  config: z.object({
    config: z
      .object({
        header: z.string().default("x-added"),
        value: z.string(),
      })
      .optional(),
  }),
  header_filter: (config) => (c) => {
    c.res.headers.set(config.header, config.value);
  },
});

describe("definePlugin", () => {
  it("applies schema defaults and rejects invalid config", () => {
    expect(addHeader.parse({ value: "v" })).toEqual({
      header: "x-added",
      value: "v",
    });
    expect(() => addHeader.parse({ value: 7 })).toThrow();
  });

  it("applies Kong's defaults from kongSchema", () => {
    const correlation = definePlugin({
      name: "correlation-id",
      version: "1.0.0",
      priority: 100001,
      config: kongSchema("correlation-id"),
    });
    expect(correlation.parse({})).toMatchObject({
      header_name: "Kong-Request-ID",
      generator: "uuid#counter",
      echo_downstream: false,
    });
  });

  it("builds a core PluginInstance with Kong's name, priority and scope", () => {
    const instance = addHeader.instance({
      id: "p1",
      scope: { route: "r1" },
      config: { value: "v" },
    });
    expect(instance).toMatchObject({
      id: "p1",
      name: "add-header",
      priority: 800,
      scope: { route: "r1" },
    });
    expect(instance.handlers.header_filter).toBeTypeOf("function");
  });

  it("runs in the gateway runner via the test kit", async () => {
    const t = testApp(addHeader, { value: "from-plugin" });
    const res = await t.request("/anything");
    expect(res.headers.get("x-added")).toBe("from-plugin");
    expect(t.upstreamCalls).toHaveLength(1);
    expect(t.events.map((e) => [e.phase, e.outcome])).toEqual([
      ["header_filter", "ok"],
    ]);
  });

  it("is also plain Hono middleware", async () => {
    const app = new Hono();
    app.use(addHeader.middleware({ header: "x-plain", value: "yes" }));
    app.get("/", (c) => c.text("hello"));
    const res = await app.request("/");
    expect(await res.text()).toBe("hello");
    expect(res.headers.get("x-plain")).toBe("yes");
  });
});

describe("testing kit", () => {
  it("echoes what reached the upstream", async () => {
    const t = testApp(addHeader, { value: "v" }, { upstream: echoUpstream });
    const res = await t.request("/path?q=1", {
      method: "POST",
      body: "payload",
    });
    expect(await res.json()).toMatchObject({
      method: "POST",
      url: "https://gateway.test/path?q=1",
      body: "payload",
    });
  });

  it("collects log-phase work for settle()", async () => {
    let logged = 0;
    const logger = definePlugin({
      name: "logger",
      version: "1.0.0",
      priority: 12,
      config: z.object({ config: z.object({}).optional() }),
      log: () => () => {
        logged++;
      },
    });
    const t = testApp(logger, {});
    await t.request("/");
    await t.settle();
    expect(logged).toBe(1);
  });

  it("gives handlers a real Hono Context", async () => {
    const path = await withContext(
      new Request("https://x.test/a/b"),
      (c) => c.req.path,
    );
    expect(path).toBe("/a/b");
  });
});
