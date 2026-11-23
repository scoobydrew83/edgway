import { type Consumer, type PluginInstance, setConsumer } from "@edgway/core";
import { errorHandler } from "@edgway/errors";
import type { PluginInput } from "@edgway/plugin-sdk";
import { testApp } from "@edgway/plugin-sdk/testing";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import acl, { type AclStore, setAclStore } from "../src/index";

const acls: Record<string, string[]> = {
  "c-admin": ["admins", "staff"],
  "c-user": ["users"],
  "c-none": [],
};
const store: AclStore = {
  groups: (id) => acls[id] ?? [],
  consumerGroups: (id) => (id === "c-user" ? ["gold"] : []),
};
const withStore: PluginInstance = {
  id: "store",
  name: "store",
  priority: Number.MAX_SAFE_INTEGER,
  scope: {},
  handlers: {
    access: async (c, next) => {
      setAclStore(c, store);
      await next();
    },
  },
};

const app = (config: PluginInput<typeof acl.config>, consumer?: Consumer) =>
  testApp(acl, config, { plugins: [withStore], consumer });
type Echo = { headers: Record<string, string> };

describe("acl", () => {
  it("uses Kong's name, priority and defaults", () => {
    expect(acl.name).toBe("acl");
    expect(acl.priority).toBe(950);
    expect(acl.parse({ allow: ["a"] })).toMatchObject({
      hide_groups_header: false,
      always_use_authenticated_groups: false,
      include_consumer_groups: false,
    });
  });

  it("blocks the request when its store breaks (fail-closed policy)", async () => {
    const broken: PluginInstance = {
      ...withStore,
      handlers: {
        access: async (c, next) => {
          setAclStore(c, {
            groups: () => {
              throw new Error("acl store unreachable");
            },
          });
          await next();
        },
      },
    };
    const t = testApp(
      acl,
      { allow: ["admins"] },
      { plugins: [broken], consumer: { id: "c-admin" } },
    );
    const res = await t.request("/");
    expect(res.status).toBe(500);
    expect(t.upstreamCalls).toHaveLength(0);
  });

  it("lets an allowed consumer through with X-Consumer-Groups", async () => {
    const res = await app({ allow: ["admins"] }, { id: "c-admin" }).request(
      "/",
      {
        headers: { "x-consumer-groups": "spoofed" },
      },
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as Echo).headers["x-consumer-groups"]).toBe(
      "admins, staff",
    );
  });

  it("blocks a consumer outside the allow list with Kong's 403", async () => {
    const t = app({ allow: ["admins"] }, { id: "c-user" });
    const res = await t.request("/");
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      code: "EDG-AUTH-019",
      title: "You cannot consume this service",
    });
    expect(t.upstreamCalls).toHaveLength(0);
  });

  it("blocks a consumer in the deny list and lets others through", async () => {
    expect(
      (await app({ deny: ["users"] }, { id: "c-user" }).request("/")).status,
    ).toBe(403);
    expect(
      (await app({ deny: ["users"] }, { id: "c-admin" }).request("/")).status,
    ).toBe(200);
    expect(
      (await app({ deny: ["users"] }, { id: "c-none" }).request("/")).status,
    ).toBe(200);
  });

  it("answers 401 without an authenticated consumer", async () => {
    const res = await app({ allow: ["admins"] }).request("/");
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "EDG-AUTH-004" });
  });

  it("hides X-Consumer-Groups with hide_groups_header", async () => {
    const res = await app(
      { allow: ["admins"], hide_groups_header: true },
      { id: "c-admin" },
    ).request("/", { headers: { "x-consumer-groups": "spoofed" } });
    expect(((await res.json()) as Echo).headers).not.toHaveProperty(
      "x-consumer-groups",
    );
  });

  it("counts consumer groups with include_consumer_groups", async () => {
    expect(
      (await app({ allow: ["gold"] }, { id: "c-user" }).request("/")).status,
    ).toBe(403);
    expect(
      (
        await app(
          { allow: ["gold"], include_consumer_groups: true },
          { id: "c-user" },
        ).request("/")
      ).status,
    ).toBe(200);
  });

  it("uses authenticated groups only as Kong does", async () => {
    // A credentialed consumer with no acls is denied, whatever groups an
    // auth plugin authenticated.
    const oidcConsumer = { id: "c-none", groups: ["idp-admins"] };
    expect(
      (await app({ allow: ["idp-admins"] }, oidcConsumer).request("/")).status,
    ).toBe(403);
    // With always_use_authenticated_groups they win over the consumer's acls,
    // and travel upstream as X-Authenticated-Groups.
    const both = { id: "c-user", groups: ["idp-admins"] };
    const res = await app(
      { allow: ["idp-admins"], always_use_authenticated_groups: true },
      both,
    ).request("/", { headers: { "x-consumer-groups": "spoofed" } });
    expect(res.status).toBe(200);
    const echo = (await res.json()) as Echo;
    expect(echo.headers["x-authenticated-groups"]).toBe("idp-admins");
    expect(echo.headers).not.toHaveProperty("x-consumer-groups");
  });

  it("uses authenticated groups for the anonymous consumer", async () => {
    const anon = { id: "c-anon", groups: ["guests"], anonymous: true };
    expect((await app({ allow: ["guests"] }, anon).request("/")).status).toBe(
      200,
    );
    // The same consumer, not anonymous: its acl rows (none) decide.
    const known = { id: "c-anon", groups: ["guests"] };
    expect((await app({ allow: ["guests"] }, known).request("/")).status).toBe(
      403,
    );
  });

  it("ignores an X-Anonymous-Consumer header: the consumer decides", async () => {
    const known = { id: "c-anon", groups: ["guests"] };
    const res = await app({ allow: ["guests"] }, known).request("/", {
      headers: { "x-anonymous-consumer": "true" },
    });
    expect(res.status).toBe(403);
  });

  it("fails closed when neither allow nor deny is set", async () => {
    const res = await app({}, { id: "c-admin" }).request("/");
    expect(res.status).toBe(500);
  });

  it("fails closed without a group store", async () => {
    const res = await testApp(
      acl,
      { allow: ["admins"] },
      { consumer: { id: "c-admin" } },
    ).request("/");
    expect(res.status).toBe(500);
  });

  it("is also plain Hono middleware", async () => {
    const plain = new Hono();
    plain.onError(errorHandler());
    plain.use(async (c, next) => {
      setAclStore(c, store);
      setConsumer(c, { id: c.req.header("x-who") ?? "" });
      await next();
    });
    plain.use(acl.middleware({ allow: ["admins"] }));
    plain.get("/", (c) => c.text("ok"));
    expect(
      await (
        await plain.request("/", { headers: { "x-who": "c-admin" } })
      ).text(),
    ).toBe("ok");
    const denied = await plain.request("/", { headers: { "x-who": "c-user" } });
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ code: "EDG-AUTH-019" });
  });
});
