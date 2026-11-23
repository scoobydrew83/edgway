import type { PluginInput } from "@edgway/plugin-sdk";
import { testApp } from "@edgway/plugin-sdk/testing";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import ipRestriction from "../src/index";

const app = (config: PluginInput<typeof ipRestriction.config>) =>
  testApp(ipRestriction, config);
const from = (ip: string) => ({ headers: { "cf-connecting-ip": ip } });

describe("ip-restriction", () => {
  it("uses Kong's name and priority", () => {
    expect(ipRestriction.name).toBe("ip-restriction");
    expect(ipRestriction.priority).toBe(990);
  });

  it("blocks denied IPs and CIDRs with Kong's 403", async () => {
    const t = app({ deny: ["203.0.113.7", "198.51.100.0/24"] });
    for (const ip of ["203.0.113.7", "198.51.100.42"]) {
      const res = await t.request("/", from(ip));
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({
        code: "EDG-AUTH-020",
        title: "Your IP address is not allowed",
      });
    }
    expect((await t.request("/", from("192.0.2.1"))).status).toBe(200);
    expect(t.upstreamCalls).toHaveLength(1);
  });

  it("allows only listed IPs and CIDRs, IPv6 included", async () => {
    const t = app({ allow: ["192.0.2.0/24", "2001:db8::/32"] });
    expect((await t.request("/", from("192.0.2.9"))).status).toBe(200);
    expect((await t.request("/", from("2001:db8::1"))).status).toBe(200);
    expect((await t.request("/", from("203.0.113.7"))).status).toBe(403);
  });

  it("checks deny before allow", async () => {
    const t = app({ allow: ["192.0.2.0/24"], deny: ["192.0.2.66"] });
    expect((await t.request("/", from("192.0.2.66"))).status).toBe(403);
    expect((await t.request("/", from("192.0.2.1"))).status).toBe(200);
  });

  it("uses the configured status and message", async () => {
    const res = await app({
      deny: ["203.0.113.7"],
      status: 451,
      message: "Not from there",
    }).request("/", from("203.0.113.7"));
    expect(res.status).toBe(451);
    expect(await res.json()).toMatchObject({
      status: 451,
      code: "EDG-AUTH-020",
      detail: "Not from there",
    });
  });

  it("rejects a request without a client IP", async () => {
    const res = await app({ allow: ["192.0.2.0/24"] }).request("/");
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "EDG-AUTH-021" });
  });

  it("rejects an unparsable client IP as not allowed", async () => {
    const res = await app({ allow: ["192.0.2.0/24"] }).request(
      "/",
      from("not-an-ip"),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "EDG-AUTH-020" });
  });

  it("fails closed when neither allow nor deny is set", async () => {
    expect((await app({}).request("/", from("192.0.2.1"))).status).toBe(500);
  });

  it("is also plain Hono middleware", async () => {
    const plain = new Hono();
    plain.use(ipRestriction.middleware({ allow: ["192.0.2.1"] }));
    plain.get("/", (c) => c.text("ok"));
    expect(await (await plain.request("/", from("192.0.2.1"))).text()).toBe(
      "ok",
    );
    expect((await plain.request("/", from("192.0.2.2"))).status).toBe(403);
  });
});
