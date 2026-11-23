import type { PluginInstance } from "@edgway/core";
import { ERR, problemResponse } from "@edgway/errors";
import type { PluginInput } from "@edgway/plugin-sdk";
import { testApp } from "@edgway/plugin-sdk/testing";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import cors from "../src/index";

const ORIGIN = "https://app.example.test";
const app = (
  config: PluginInput<typeof cors.config> = {},
  plugins: PluginInstance[] = [],
) => testApp(cors, config, { plugins });
const preflight = (origin = ORIGIN, extra: Record<string, string> = {}) => ({
  method: "OPTIONS",
  headers: {
    origin,
    "access-control-request-method": "POST",
    "access-control-request-headers": "x-one, x-two",
    ...extra,
  },
});

describe("cors", () => {
  it("uses Kong's name, priority and defaults", () => {
    expect(cors.name).toBe("cors");
    expect(cors.priority).toBe(2000);
    expect(cors.parse({})).toMatchObject({
      credentials: false,
      preflight_continue: false,
      private_network: false,
    });
  });

  it("allows every origin with * by default", async () => {
    const t = app();
    const res = await t.request("/", { headers: { origin: ORIGIN } });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("vary")).toBeNull();
    expect(t.upstreamCalls).toHaveLength(1);
  });

  it("answers a preflight itself with Kong's 200", async () => {
    const t = app({ max_age: 600 });
    const res = await t.request("/", preflight());
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-methods")).toBe(
      "CONNECT,DELETE,GET,HEAD,OPTIONS,PATCH,POST,PUT,TRACE",
    );
    expect(res.headers.get("access-control-allow-headers")).toBe("x-one,x-two");
    expect(res.headers.get("access-control-max-age")).toBe("600");
    expect(t.upstreamCalls).toHaveLength(0);
  });

  it("proxies a plain OPTIONS request and adds only Kong's response headers", async () => {
    const t = app({ max_age: 600 });
    const res = await t.request("/", {
      method: "OPTIONS",
      headers: { origin: ORIGIN },
    });
    expect(t.upstreamCalls).toHaveLength(1);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toMatchObject({ method: "OPTIONS" });
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-methods")).toBeNull();
    expect(res.headers.get("access-control-max-age")).toBeNull();
  });

  it("proxies an OPTIONS request without Origin even with Access-Control-Request-Method", async () => {
    const t = app();
    await t.request("/", {
      method: "OPTIONS",
      headers: { "access-control-request-method": "POST" },
    });
    expect(t.upstreamCalls).toHaveLength(1);
  });

  it("echoes an allowed origin and varies on Origin", async () => {
    const t = app({ origins: ["https://app.example.test:443", "other.test"] });
    const ok = await t.request("/", { headers: { origin: ORIGIN } });
    expect(ok.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(ok.headers.get("vary")).toContain("Origin");
    // A scheme-less plain entry is compared as written, as Kong normalizes it.
    const host = await t.request("/", {
      headers: { origin: "http://other.test" },
    });
    expect(host.headers.get("access-control-allow-origin")).toBeNull();
    const denied = await t.request("/", {
      headers: { origin: "https://evil.test" },
    });
    expect(denied.status).toBe(200);
    expect(denied.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("allows every origin only when * is the sole entry", async () => {
    const res = await app({ origins: ["*", "https://other.test"] }).request(
      "/",
      {
        headers: { origin: ORIGIN },
      },
    );
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("matches regex origins, anchored", async () => {
    const t = app({ origins: ["https://.*\\.example\\.test"] });
    const ok = await t.request("/", { headers: { origin: ORIGIN } });
    expect(ok.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    const suffix = await t.request("/", {
      headers: { origin: "https://app.example.test.evil.test" },
    });
    expect(suffix.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("echoes the Origin instead of * when credentials are allowed", async () => {
    const res = await app({ credentials: true }).request("/", {
      headers: { origin: ORIGIN },
    });
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
  });

  it("uses the configured methods, headers and exposed headers", async () => {
    const t = app({
      methods: ["GET", "POST"],
      headers: ["x-custom"],
      exposed_headers: ["x-request-id", "x-total"],
    });
    const pre = await t.request("/", preflight());
    expect(pre.headers.get("access-control-allow-methods")).toBe("GET,POST");
    expect(pre.headers.get("access-control-allow-headers")).toBe("x-custom");
    const res = await t.request("/", { headers: { origin: ORIGIN } });
    expect(res.headers.get("access-control-expose-headers")).toBe(
      "x-request-id,x-total",
    );
  });

  it("allows private network access when asked", async () => {
    const t = app({ private_network: true });
    const res = await t.request(
      "/",
      preflight(ORIGIN, { "access-control-request-private-network": "true" }),
    );
    expect(res.headers.get("access-control-allow-private-network")).toBe(
      "true",
    );
    const off = await app().request(
      "/",
      preflight(ORIGIN, { "access-control-request-private-network": "true" }),
    );
    expect(off.headers.get("access-control-allow-private-network")).toBeNull();
  });

  it("leaves a continued preflight to the upstream, as Kong does", async () => {
    const t = app({ preflight_continue: true });
    const res = await t.request("/", preflight());
    expect(t.upstreamCalls).toHaveLength(1);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toMatchObject({ method: "OPTIONS" });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(res.headers.get("access-control-allow-methods")).toBeNull();
  });

  it("adds CORS headers to errors from other plugins", async () => {
    const deny: PluginInstance = {
      id: "deny",
      name: "deny",
      priority: 1,
      scope: {},
      handlers: { access: async () => problemResponse(ERR.AUTH_REQUIRED) },
    };
    const res = await app({}, [deny]).request("/", {
      headers: { origin: ORIGIN },
    });
    expect(res.status).toBe(401);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("is also plain Hono middleware", async () => {
    const plain = new Hono();
    plain.use(cors.middleware({ origins: [ORIGIN] }));
    plain.get("/", (c) => c.text("ok"));
    const res = await plain.request("/", { headers: { origin: ORIGIN } });
    expect(await res.text()).toBe("ok");
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    const pre = await plain.request("/", preflight());
    expect(pre.status).toBe(200);
  });
});
