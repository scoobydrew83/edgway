import type { PluginInput } from "@edgway/plugin-sdk";
import { testApp } from "@edgway/plugin-sdk/testing";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import termination from "../src/index";

const app = (config: PluginInput<typeof termination.config> = {}) =>
  testApp(termination, config);

describe("request-termination", () => {
  it("uses Kong's name, priority and defaults", () => {
    expect(termination.name).toBe("request-termination");
    expect(termination.priority).toBe(2);
    expect(termination.parse({})).toMatchObject({
      status_code: 503,
      echo: false,
    });
  });

  it("terminates with Kong's 503 by default, never calling the upstream", async () => {
    const t = app();
    const res = await t.request("/");
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "EDG-PLG-003" });
    expect(t.upstreamCalls).toHaveLength(0);
  });

  it("uses status_code and message", async () => {
    const res = await app({
      status_code: 403,
      message: "Closed for maintenance",
    }).request("/");
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      status: 403,
      detail: "Closed for maintenance",
    });
  });

  it("sends a raw body with its content type", async () => {
    const json = await app({ status_code: 200, body: '{"ok":true}' }).request(
      "/",
    );
    expect(json.status).toBe(200);
    expect(json.headers.get("content-type")).toBe(
      "application/json; charset=utf-8",
    );
    expect(await json.text()).toBe('{"ok":true}');
    const html = await app({
      body: "<h1>Down</h1>",
      content_type: "text/html",
    }).request("/");
    expect(html.headers.get("content-type")).toBe("text/html");
    expect(await html.text()).toBe("<h1>Down</h1>");
  });

  it("answers null-body statuses without a body", async () => {
    const res = await app({ status_code: 204 }).request("/");
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
  });

  it("echoes the request", async () => {
    const res = await app({ echo: true, status_code: 200 }).request("/p?x=1", {
      headers: { "x-test": "yes" },
    });
    const body = (await res.json()) as {
      request: { method: string; path: string; query: object; headers: object };
    };
    expect(body.request).toMatchObject({
      method: "GET",
      path: "/p",
      query: { x: "1" },
      headers: { "x-test": "yes" },
    });
  });

  it("only terminates requests carrying the trigger header or query parameter", async () => {
    const t = app({ trigger: "x-maintenance" });
    expect((await t.request("/")).status).toBe(200);
    expect(
      (await t.request("/", { headers: { "x-maintenance": "1" } })).status,
    ).toBe(503);
    expect((await t.request("/?x-maintenance")).status).toBe(503);
    expect(t.upstreamCalls).toHaveLength(1);
  });

  it("is also plain Hono middleware", async () => {
    const plain = new Hono();
    plain.use(termination.middleware({ status_code: 410, message: "Gone" }));
    plain.get("/", (c) => c.text("never"));
    expect((await plain.request("/")).status).toBe(410);
  });
});
