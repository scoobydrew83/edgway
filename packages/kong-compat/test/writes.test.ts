import { env } from "cloudflare:test";
import {
  createAdminCore,
  kongCatalog,
  pluginCatalog,
} from "@edgway/admin-core";
import { KONG_HIDDEN_KEY } from "@edgway/constants";
import { sha256Hex } from "@edgway/core";
import { ERR, errorHandler, STATUS } from "@edgway/errors";
import { t } from "@edgway/i18n";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { kongAdminApi } from "../src/index";

const workspaceId = "0199a3c0-0000-7000-a000-000000000002";
const admin = createAdminCore(env.DB, { workspaceId, actor: "test" });

const app = new Hono();
app.use("*", async (c, next) => {
  c.set("adminCore", admin);
  await next();
});
app.route("/", kongAdminApi());
app.onError(errorHandler({ format: "kong" }));

type Json = Record<string, unknown>;

async function send(method: string, path: string, body?: unknown) {
  const res = await app.request(path, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as Json };
}

const SERVICE_ID = "68f0df24-ac4d-4d19-9d8c-61dc56b41455";
const ROUTE_ID = "fb278c2a-af82-47cd-aca7-a50edeb6bffe";

describe("writes as decK sends them", () => {
  it("creates with PUT and a client id, and answers the entity", async () => {
    const service = await send("PUT", `/services/${SERVICE_ID}`, {
      id: SERVICE_ID,
      name: "anything",
      host: "httpbin.org",
      port: 443,
      path: "/anything",
      protocol: "https",
    });
    expect(service.status).toBe(STATUS.ok);
    expect(service.body).toMatchObject({
      id: SERVICE_ID,
      name: "anything",
      retries: 5,
    });
    const route = await send("PUT", `/routes/${ROUTE_ID}`, {
      id: ROUTE_ID,
      name: "anything-get",
      paths: ["/anything"],
      methods: ["GET"],
      service: { id: SERVICE_ID },
      strip_path: true,
    });
    expect(route.body).toMatchObject({
      service: { id: SERVICE_ID },
      strip_path: true,
    });
    expect((await admin.routes.get(ROUTE_ID)).service_id).toBe(SERVICE_ID);
  });

  it("replaces on PUT: omitted fields go back to their defaults", async () => {
    await send("PATCH", `/services/${SERVICE_ID}`, { retries: 9 });
    expect((await admin.services.get(SERVICE_ID)).retries).toBe(9);
    const put = await send("PUT", "/services/anything", {
      host: "example.org",
    });
    expect(put.body).toMatchObject({
      id: SERVICE_ID,
      name: "anything",
      host: "example.org",
      retries: 5,
      path: null,
    });
  });

  it("upserts by name, and creates with POST (201)", async () => {
    const byName = await send("PUT", "/upstreams/backend", {});
    expect(byName.status).toBe(STATUS.ok);
    expect(byName.body).toMatchObject({ name: "backend" });
    const post = await send("POST", "/consumers", { username: "alice" });
    expect(post.status).toBe(STATUS.created);
    expect(post.body).toMatchObject({ username: "alice" });
  });

  it("parses a service url into its parts", async () => {
    const { body } = await send("POST", "/services", {
      name: "by-url",
      url: "https://api.example.com/v1",
    });
    expect(body).toMatchObject({
      protocol: "https",
      host: "api.example.com",
      port: 443,
      path: "/v1",
    });
  });

  it("resolves references by name as well as id", async () => {
    const { body } = await send("POST", "/routes", {
      name: "by-name",
      paths: ["/by-name"],
      service: { name: "anything" },
    });
    expect(body).toMatchObject({ service: { id: SERVICE_ID } });
  });

  it("writes nested collections with the parent's reference", async () => {
    const plugin = await send("POST", `/routes/${ROUTE_ID}/plugins`, {
      name: "rate-limiting",
      config: { minute: 10, policy: "local" },
    });
    expect(plugin.status).toBe(STATUS.created);
    expect(plugin.body).toMatchObject({
      route: { id: ROUTE_ID },
      config: { minute: 10, fault_tolerant: true },
    });
    const target = await send("POST", "/upstreams/backend/targets", {
      target: "a.internal:80",
    });
    expect(target.body).toMatchObject({ target: "a.internal:80" });
    const del = await send(
      "DELETE",
      "/upstreams/backend/targets/a.internal:80",
    );
    expect(del.status).toBe(STATUS.noContent);
    expect((await send("GET", "/upstreams/backend/targets")).body.data).toEqual(
      [],
    );
  });

  it("stores plugin configs without the nulls decK sends back", async () => {
    const id = "0199a3c0-0000-7000-a000-00000000aaaa";
    const { status } = await send("PUT", `/plugins/${id}`, {
      name: "cors",
      config: { origins: ["*"], max_age: null, headers: null },
      service: { id: SERVICE_ID },
    });
    expect(status).toBe(STATUS.ok);
    expect((await admin.plugins.get(id)).config).toEqual({ origins: ["*"] });
  });

  it("answers Kong's 'plugin not enabled' for plugins Edgway lacks", async () => {
    const { status, body } = await send("POST", "/plugins", {
      name: "rate-limiting-advanced",
      config: {},
    });
    expect(status).toBe(ERR.ADMIN_PLUGIN_NOT_ENABLED.status);
    expect(body).toEqual({
      message: t(ERR.ADMIN_PLUGIN_NOT_ENABLED.message),
    });
  });

  it("accepts every vendored plugin, now all bundled", async () => {
    // ai-proxy was the unbundled example until an earlier release; the not-enabled answer
    // for an unbundled plugin is the rate-limiting-advanced case above.
    const { status } = await send("POST", "/plugins", {
      name: "ai-proxy",
      config: { route_type: "llm/v1/chat", model: { provider: "openai" } },
    });
    expect(status).toBe(STATUS.created);
  });

  it("accepts and returns a plugin's on_error", async () => {
    const { status, body } = await send("POST", "/plugins", {
      name: "acl",
      config: { allow: ["admins"] },
      on_error: "fail-open",
    });
    expect(status).toBe(STATUS.created);
    expect(body).toMatchObject({ on_error: "fail-open" });
  });

  it("rejects an invalid plugin config with Kong's 400", async () => {
    const { status, body } = await send("POST", "/plugins", {
      name: "rate-limiting",
      config: { minute: "lots" },
    });
    expect(status).toBe(ERR.ADMIN_INVALID_REQUEST.status);
    expect(body).toHaveProperty("message");
  });

  it("merges a plugin PATCH into its config", async () => {
    const { body } = await send("POST", "/plugins", {
      name: "rate-limiting",
      instance_name: "rl-patch",
      config: { minute: 5, policy: "local" },
    });
    const patched = await send("PATCH", `/plugins/${body.id}`, {
      config: { hour: 50 },
    });
    expect(patched.body).toMatchObject({ config: { minute: 5, hour: 50 } });
    expect(
      (await send("PATCH", "/plugins/rl-patch", { enabled: false })).body,
    ).toMatchObject({ enabled: false, config: { minute: 5 } });
  });

  it("answers DELETE with 204, found or not, and 404 on PATCH of nothing", async () => {
    const created = await send("POST", "/consumers", { username: "gone" });
    expect((await send("DELETE", "/consumers/gone")).status).toBe(
      STATUS.noContent,
    );
    expect((await send("DELETE", "/consumers/gone")).status).toBe(
      STATUS.noContent,
    );
    expect((await send("GET", `/consumers/${created.body.id}`)).status).toBe(
      ERR.ADMIN_NOT_FOUND.status,
    );
    expect((await send("PATCH", "/consumers/nope", {})).status).toBe(
      ERR.ADMIN_NOT_FOUND.status,
    );
  });

  it("answers unknown paths with Kong's JSON 404", async () => {
    const res = await send("PUT", `/consumers/alice/hmac-auth/${ROUTE_ID}`, {});
    expect(res.status).toBe(ERR.ADMIN_NOT_FOUND.status);
    expect(res.body).toEqual({ message: t(ERR.ADMIN_NOT_FOUND.message) });
  });

  it("answers Kong's errors for conflicts and references in use", async () => {
    const dup = await send("POST", "/services", {
      name: "anything",
      host: "x.org",
    });
    expect(dup.status).toBe(ERR.ADMIN_CONFLICT.status);
    expect(dup.body).toHaveProperty("message");
    const inUse = await send("DELETE", `/services/${SERVICE_ID}`);
    expect(inUse.status).toBe(ERR.ADMIN_INVALID_REQUEST.status);
    expect(await admin.services.get(SERVICE_ID)).toBeTruthy();
    const bad = await send("POST", "/services", "not an object");
    expect(bad.status).toBe(ERR.ADMIN_INVALID_REQUEST.status);
  });
});

describe("credentials", () => {
  it("creates key-auth under a consumer and returns the key only on write", async () => {
    const id = "0199a3c0-0000-7000-a000-00000000bbbb";
    const put = await send("PUT", `/consumers/alice/key-auth/${id}`, {
      id,
      key: "alice-secret-key-0123456789abcdef",
    });
    expect(put.status).toBe(STATUS.ok);
    expect(put.body).toMatchObject({
      id,
      key: "alice-secret-key-0123456789abcdef",
    });
    const read = await send("GET", `/key-auths/${id}`);
    // decK indexes key-auth by key: reads carry a placeholder, never the key.
    expect(read.body.key).toBe(`${KONG_HIDDEN_KEY.prefix}${id}`);
    expect(JSON.stringify(read)).not.toContain(
      "alice-secret-key-0123456789abcdef",
    );
    expect(JSON.stringify(read)).not.toContain(
      await sha256Hex("alice-secret-key-0123456789abcdef"),
    );
    // Writing the placeholder back (a dump re-synced) keeps the stored key.
    const kept = await send("PUT", `/key-auths/${id}`, {
      key: read.body.key,
      consumer: read.body.consumer,
    });
    expect(kept.status).toBe(STATUS.ok);
    expect(
      (await admin.keyAuth.list({ where: { id } })).data[0]?.key_prefix,
    ).toBe("alice-se");
    expect(
      (
        await send("POST", "/key-auths", {
          key: read.body.key,
          consumer: read.body.consumer,
        })
      ).status,
    ).toBe(ERR.ADMIN_INVALID_REQUEST.status);
    // decK resends the key on every sync: the same key is a no-op rotate.
    const again = await send("PUT", `/consumers/alice/key-auth/${id}`, {
      id,
      key: "alice-secret-key-0123456789abcdef",
    });
    expect(again.status).toBe(STATUS.ok);
    const rotated = await send("PUT", `/consumers/alice/key-auth/${id}`, {
      key: "alice-new-key",
    });
    expect(rotated.body).toMatchObject({ id, key: "alice-new-key" });
    // Tags or ttl can't change on a hashed key: Kong's 400.
    const tagged = await send("PATCH", `/key-auths/${id}`, { tags: ["x"] });
    expect(tagged.status).toBe(ERR.ADMIN_INVALID_REQUEST.status);
  });

  it("hashes basic-auth passwords in Kong's format and never returns them", async () => {
    const { body } = await send("POST", "/consumers/alice/basic-auth", {
      username: "alice",
      password: "pw",
    });
    const stored = await admin.basicAuth.list({ where: { username: "alice" } });
    expect(stored.data[0]?.id).toBe(body.id);
    expect(JSON.stringify(body)).not.toContain("password");
    const patched = await send("PATCH", `/basic-auths/${body.id}`, {
      password: "pw2",
    });
    expect(patched.status).toBe(STATUS.ok);
  });

  it("takes certificate keys only as vault references", async () => {
    const raw = await send("POST", "/certificates", {
      cert: "-----BEGIN CERTIFICATE-----",
      key: "-----BEGIN PRIVATE KEY-----",
    });
    expect(raw.status).toBe(ERR.ADMIN_INVALID_REQUEST.status);
    const ref = await send("POST", "/certificates", {
      cert: "-----BEGIN CERTIFICATE-----",
      key: "{vault://env/tls-key}",
    });
    expect(ref.status).toBe(STATUS.created);
  });

  it("takes JWT secrets only as vault references", async () => {
    const raw = await send("POST", "/consumers/alice/jwt", {
      key: "iss-a",
      secret: "plain-secret",
    });
    expect(raw.status).toBe(ERR.ADMIN_INVALID_REQUEST.status);
    const ref = await send("POST", "/consumers/alice/jwt", {
      key: "iss-a",
      secret: "{vault://env/jwt-a}",
    });
    expect(ref.status).toBe(STATUS.created);
    const acl = await send("POST", "/consumers/alice/acls", { group: "ops" });
    expect(acl.body).toMatchObject({
      group: "ops",
      consumer: { id: expect.any(String) },
    });
  });
});

describe("consumer groups", () => {
  it("adds and removes members from either side", async () => {
    await send("PUT", "/consumer_groups/gold", {});
    const added = await send("POST", "/consumer_groups/gold/consumers", {
      consumer: "alice",
    });
    expect(added.status).toBe(STATUS.created);
    expect((added.body.consumers as Json[]).map((c) => c.username)).toEqual([
      "alice",
    ]);
    const groups = await send("GET", "/consumers/alice/consumer_groups");
    expect((groups.body.data as Json[]).map((g) => g.name)).toEqual(["gold"]);
    expect(
      (await send("DELETE", "/consumer_groups/gold/consumers/alice")).status,
    ).toBe(STATUS.noContent);
    const viaConsumer = await send("POST", "/consumers/alice/consumer_groups", {
      group: ["gold"],
    });
    expect(viaConsumer.status).toBe(STATUS.created);
    const members = await send("GET", "/consumer_groups/gold/consumers");
    expect((members.body.data as Json[]).map((c) => c.username)).toEqual([
      "alice",
    ]);
    expect(
      (await send("DELETE", "/consumers/alice/consumer_groups/gold")).status,
    ).toBe(STATUS.noContent);
  });
});

describe("the default workspace (Kong's Terraform provider)", () => {
  it("serves the same API under /default/", async () => {
    const created = await send("POST", "/default/services", {
      name: "workspace-prefixed",
      host: "example.test",
    });
    expect(created.status).toBe(STATUS.created);
    const read = await send("GET", "/default/services/workspace-prefixed");
    expect(read.status).toBe(STATUS.ok);
    expect(read.body.id).toBe(created.body.id);
    expect((await send("GET", "/services/workspace-prefixed")).body.id).toBe(
      created.body.id,
    );
    const root = await send("GET", "/default");
    expect(root.body.version).toBe("3.9.0");
    const deleted = await send(
      "DELETE",
      "/default/services/workspace-prefixed",
    );
    expect(deleted.status).toBe(STATUS.noContent);
  });

  it("answers Kong's 404 for any other workspace", async () => {
    const res = await send("GET", "/team-a/services");
    expect(res.status).toBe(ERR.ADMIN_NOT_FOUND.status);
    expect(res.body).toEqual({ message: t(ERR.ADMIN_NOT_FOUND.message) });
  });
});

describe("the gateway's bundled plugins", () => {
  // A third-party plugin's own schema, as `definePlugin` keeps it.
  const greeting = z.object({
    config: z.object({ greeting: z.string() }),
  });
  const bundled = createAdminCore(env.DB, {
    workspaceId,
    actor: "test",
    plugins: pluginCatalog([
      ...kongCatalog(["key-auth"]).values(),
      { name: "greeting", config: greeting },
    ]),
  });
  const thirdParty = new Hono();
  thirdParty.use("*", async (c, next) => {
    c.set("adminCore", bundled);
    await next();
  });
  thirdParty.route("/", kongAdminApi());
  thirdParty.onError(errorHandler({ format: "kong" }));
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await thirdParty.request(path, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as Json };
  };

  it("lists only what the gateway bundles", async () => {
    const root = await call("GET", "/");
    expect(
      Object.keys(
        (root.body.plugins as { available_on_server: Json })
          .available_on_server,
      ).sort(),
    ).toEqual(["greeting", "key-auth"]);
  });

  it("validates a third-party plugin against its own schema", async () => {
    const bad = await call("POST", "/plugins", {
      name: "greeting",
      config: {},
    });
    expect(bad.status).toBe(ERR.ADMIN_INVALID_REQUEST.status);
    const good = await call("POST", "/plugins", {
      name: "greeting",
      config: { greeting: "hi" },
    });
    expect(good.status).toBe(STATUS.created);
    expect(good.body).toMatchObject({
      name: "greeting",
      config: { greeting: "hi" },
    });
  });

  it("refuses a vendored Kong plugin this gateway doesn't bundle", async () => {
    const refused = await call("POST", "/plugins", {
      name: "cors",
      config: {},
    });
    expect(refused.status).toBe(ERR.ADMIN_PLUGIN_NOT_ENABLED.status);
  });
});
