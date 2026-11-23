import type { PluginInput } from "@edgway/plugin-sdk";
import { testApp } from "@edgway/plugin-sdk/testing";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import correlationId from "../src/index";

type Echo = { headers: Record<string, string> };
const app = (config: PluginInput<typeof correlationId.config> = {}) =>
  testApp(correlationId, config);
const UUID =
  "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";

describe("correlation-id", () => {
  it("uses Kong's name, priority and defaults", () => {
    expect(correlationId.name).toBe("correlation-id");
    expect(correlationId.priority).toBe(100001);
    expect(correlationId.parse({})).toMatchObject({
      header_name: "Kong-Request-ID",
      generator: "uuid#counter",
      echo_downstream: false,
    });
  });

  it("generates uuid#counter ids by default and sends them upstream only", async () => {
    const t = app();
    const first = await t.request("/");
    const second = await t.request("/");
    const a = ((await first.json()) as Echo).headers["kong-request-id"] ?? "";
    const b = ((await second.json()) as Echo).headers["kong-request-id"] ?? "";
    expect(a).toMatch(new RegExp(`^${UUID}#\\d+$`));
    expect(a.split("#")[0]).toBe(b.split("#")[0]);
    expect(Number(b.split("#")[1])).toBeGreaterThan(Number(a.split("#")[1]));
    expect(first.headers.get("kong-request-id")).toBeNull();
  });

  it("generates plain uuids and tracker ids", async () => {
    const uuid = (
      (await (await app({ generator: "uuid" }).request("/")).json()) as Echo
    ).headers["kong-request-id"];
    expect(uuid).toMatch(new RegExp(`^${UUID}$`));
    const tracker = (
      (await (await app({ generator: "tracker" }).request("/")).json()) as Echo
    ).headers["kong-request-id"];
    expect(tracker).toMatch(/^[\w]+-[\w-]+-\d+-\d+$/);
  });

  it("keeps an id the request already carries, even with Kong's # form", async () => {
    const res = await app().request("/", {
      headers: { "kong-request-id": "abc#42" },
    });
    expect(((await res.json()) as Echo).headers["kong-request-id"]).toBe(
      "abc#42",
    );
  });

  it("uses header_name and echoes the id with echo_downstream", async () => {
    const res = await app({
      header_name: "x-correlation-id",
      echo_downstream: true,
    }).request("/");
    const upstream = ((await res.json()) as Echo).headers["x-correlation-id"];
    expect(upstream).toBeTruthy();
    expect(res.headers.get("x-correlation-id")).toBe(upstream);
  });

  it("passes through an upstream's own echo of the id without echo_downstream", async () => {
    const t = testApp(
      correlationId,
      {},
      {
        upstream: (c) =>
          c.text("ok", 200, {
            "kong-request-id": c.req.header("kong-request-id") ?? "",
          }),
      },
    );
    const res = await t.request("/", {
      headers: { "kong-request-id": "abc#42" },
    });
    expect(res.headers.get("kong-request-id")).toBe("abc#42");
  });

  it("is also plain Hono middleware, exposing Hono's requestId", async () => {
    const plain = new Hono();
    plain.use(correlationId.middleware({ generator: "uuid" }));
    plain.get("/", (c) => c.text(c.get("requestId")));
    expect(await (await plain.request("/")).text()).toMatch(
      new RegExp(`^${UUID}$`),
    );
  });
});
