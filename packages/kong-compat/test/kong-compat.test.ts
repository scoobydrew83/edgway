import { env } from "cloudflare:test";
import { createAdminCore } from "@edgway/admin-core";
import { KONG_COMPAT } from "@edgway/constants";
import { sha256Hex } from "@edgway/core";
import { ERR, errorHandler } from "@edgway/errors";
import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import { kongAdminApi } from "../src/index";

const workspaceId = "0199a3c0-0000-7000-a000-000000000001";
const admin = createAdminCore(env.DB, { workspaceId, actor: "test" });

const app = new Hono();
app.use("*", async (c, next) => {
  c.set("adminCore", admin);
  await next();
});
app.route("/", kongAdminApi());
app.onError(errorHandler({ format: "kong" }));

const get = async <T = Record<string, unknown>>(path: string) => {
  const res = await app.request(path);
  return { status: res.status, body: (await res.json()) as T };
};

type Page = {
  data: Record<string, unknown>[];
  next: string | null;
  offset: string | null;
};

let service: Record<string, unknown>;
let route: Record<string, unknown>;
let key: string;

beforeAll(async () => {
  service = await admin.services.create({
    name: "httpbin",
    protocol: "https",
    host: "httpbin.org",
    port: 443,
    path: "/anything",
    tags: ["demo"],
  });
  route = await admin.routes.create({
    name: "httpbin-get",
    service_id: service.id,
    paths: ["/demo/httpbin"],
    methods: ["GET"],
    tags: ["demo", "public"],
  });
  await admin.plugins.create({
    name: "rate-limiting",
    route_id: route.id,
    config: { minute: 30, limit_by: "ip", policy: "local" },
  });
  const consumer = await admin.consumers.create({ username: "dev-seed" });
  key = (await admin.keyAuth.create({ consumer_id: String(consumer.id) })).key;
  await admin.basicAuth.create({
    consumer_id: String(consumer.id),
    username: "dev",
    password: "pw",
  });
  const upstream = await admin.upstreams.create({ name: "backend" });
  await admin.targets.create({
    upstream_id: upstream.id,
    target: "a.internal:80",
  });
});

describe("Kong node info", () => {
  it("reports Kong 3.9 with a database, so decK uses entity endpoints", async () => {
    const { body } = await get<{
      version: string;
      configuration: { database: string };
      plugins: { available_on_server: Record<string, unknown> };
    }>("/");
    expect(body.version).toBe(KONG_COMPAT.version);
    expect(body.configuration.database).toBe(KONG_COMPAT.database);
    expect(body.plugins.available_on_server).toHaveProperty("rate-limiting");
    expect((await get("/status")).status).toBe(200);
  });
});

describe("collections", () => {
  it("lists in Kong's shape, with references as {id} and no workspace", async () => {
    const { body } = await get<Page>("/routes");
    expect(body.next).toBeNull();
    expect(body.data[0]).toMatchObject({
      name: "httpbin-get",
      service: { id: service.id },
      paths: ["/demo/httpbin"],
    });
    expect(body.data[0]).not.toHaveProperty("service_id");
    expect(body.data[0]).not.toHaveProperty("workspace_id");
    const services = await get<Page>("/services");
    expect(services.body.data[0]).toMatchObject({
      name: "httpbin",
      client_certificate: null,
    });
  });

  it("returns plugin configs with Kong's defaults filled in", async () => {
    const { body } = await get<Page>("/plugins");
    expect(body.data[0]).toMatchObject({
      name: "rate-limiting",
      route: { id: route.id },
      service: null,
      config: {
        minute: 30,
        limit_by: "ip",
        policy: "local",
        fault_tolerant: true,
      },
    });
  });

  it("pages with offset and next, and filters by tags", async () => {
    await admin.consumers.create({ username: "second" });
    const first = await get<Page>("/consumers?size=1");
    expect(first.body.data).toHaveLength(1);
    expect(first.body.next).toMatch(/^\/consumers\?offset=.+&size=1$/);
    const second = await get<Page>(first.body.next as string);
    expect(second.body.data).toHaveLength(1);
    expect(second.body.data[0]?.id).not.toBe(first.body.data[0]?.id);
    expect(
      (await get<Page>("/routes?tags=demo,public")).body.data,
    ).toHaveLength(1);
    expect((await get<Page>("/routes?tags=demo,nope")).body.data).toHaveLength(
      0,
    );
    expect(
      (await get<Page>("/routes?tags=nope/public")).body.data,
    ).toHaveLength(1);
  });

  it("finds entities by id or name, and answers Kong's 404", async () => {
    expect((await get(`/services/${service.id}`)).body).toMatchObject({
      name: "httpbin",
    });
    expect((await get("/services/httpbin")).body).toMatchObject({
      id: service.id,
    });
    expect((await get("/consumers/dev-seed")).body).toMatchObject({
      username: "dev-seed",
    });
    const missing = await get("/services/nope");
    expect(missing.status).toBe(ERR.ADMIN_NOT_FOUND.status);
    expect(missing.body).toHaveProperty("message");
  });

  it("answers a consumer group with its members and plugins, as Kong does", async () => {
    const group = await admin.consumer_groups.create({ name: "gold" });
    const member = await admin.consumers.lookup("dev-seed", "username");
    await admin.groupMembers.add(String(group.id), String(member.id));
    const { body } = await get<{
      consumer_group: Record<string, unknown>;
      consumers: Record<string, unknown>[];
      plugins: unknown[];
    }>("/consumer_groups/gold");
    expect(body.consumer_group).toMatchObject({ id: group.id, name: "gold" });
    expect(body.consumers.map((c) => c.username)).toEqual(["dev-seed"]);
    expect(body.plugins).toEqual([]);
  });

  it("serves nested collections", async () => {
    expect(
      (await get<Page>("/services/httpbin/routes")).body.data,
    ).toHaveLength(1);
    expect(
      (await get<Page>(`/routes/${route.id}/plugins`)).body.data,
    ).toHaveLength(1);
    const targets = await get<Page>("/upstreams/backend/targets");
    expect(targets.body.data[0]).toMatchObject({
      target: "a.internal:80",
      upstream: { id: expect.any(String) },
    });
    const id = String(targets.body.data[0]?.id);
    for (const ref of [id, "a.internal:80"]) {
      expect(
        (await get(`/upstreams/backend/targets/${ref}`)).body,
      ).toMatchObject({
        id,
        target: "a.internal:80",
      });
    }
    expect((await get("/upstreams/backend/targets/nope:1")).status).toBe(
      ERR.ADMIN_NOT_FOUND.status,
    );
    const keys = await get<Page>("/consumers/dev-seed/key-auth");
    expect(keys.body.data[0]).toMatchObject({
      consumer: { id: expect.any(String) },
    });
  });

  it("never returns credential hashes", async () => {
    const all = JSON.stringify([
      (await get("/key-auths")).body,
      (await get("/basic-auths")).body,
      (await get("/consumers/dev-seed/key-auth")).body,
    ]);
    expect(all).not.toContain(await sha256Hex(key));
    expect(all).not.toContain("key_hash");
    expect(all).not.toContain("password");
  });

  it("keeps a portal key's name out of the Kong mount", async () => {
    const consumer = await admin.consumers.create({ username: "named-keys" });
    const { credential } = await admin.keyAuth.create({
      consumer_id: String(consumer.id),
      name: "my laptop",
    });
    expect(credential.name).toBe("my laptop");
    const read = await get(`/key-auths/${credential.id}`);
    expect(read.status).toBe(200);
    expect(read.body).not.toHaveProperty("name");
    // Other entities keep theirs.
    expect((await get("/consumers/named-keys")).body).toMatchObject({
      username: "named-keys",
    });
  });

  it("keeps a consumer's display name out of the Kong mount", async () => {
    const consumer = await admin.consumers.create({
      username: "labelled",
      display_name: "Dev Label",
    });
    const read = await get(`/consumers/${consumer.id}`);
    expect(read.body).not.toHaveProperty("display_name");
    // Kong's PUT can neither set it nor reset it.
    const put = await app.request("/consumers/labelled", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "labelled", display_name: "forged" }),
    });
    expect(put.status).toBe(200);
    expect((await admin.consumers.get(String(consumer.id))).display_name).toBe(
      "Dev Label",
    );
    const schema = await get<{ fields: Record<string, unknown>[] }>(
      "/schemas/consumers",
    );
    expect(JSON.stringify(schema.body)).not.toContain("display_name");
  });

  it("answers the collections Edgway doesn't have with empty pages", async () => {
    for (const path of ["/key-sets", "/keys", "/hmac-auths", "/partials"]) {
      expect((await get<Page>(path)).body).toEqual({
        data: [],
        next: null,
        offset: null,
      });
    }
  });
});

describe("schemas", () => {
  const fieldOf = (fields: Record<string, unknown>[], name: string) =>
    fields.find((f) => name in f)?.[name] as Record<string, unknown>;

  it("serves entity schemas with Kong's defaults", async () => {
    const { body } = await get<{ fields: Record<string, unknown>[] }>(
      "/schemas/services",
    );
    expect(fieldOf(body.fields, "retries")).toMatchObject({ default: 5 });
    expect(fieldOf(body.fields, "protocol")).toMatchObject({ default: "http" });
    const routes = await get<{ fields: Record<string, unknown>[] }>(
      "/schemas/routes",
    );
    expect(fieldOf(routes.body.fields, "strip_path")).toMatchObject({
      default: true,
    });
  });

  it("types JSON columns as Kong does", async () => {
    const routes = await get<{ fields: Record<string, unknown>[] }>(
      "/schemas/routes",
    );
    const type = (fields: Record<string, unknown>[], name: string) =>
      fieldOf(fields, name)?.type;
    expect(type(routes.body.fields, "headers")).toBe("map");
    expect(type(routes.body.fields, "protocols")).toBe("set");
    expect(type(routes.body.fields, "methods")).toBe("set");
    expect(type(routes.body.fields, "paths")).toBe("array");
    expect(type(routes.body.fields, "tags")).toBe("set");
    const upstreams = await get<{ fields: Record<string, unknown>[] }>(
      "/schemas/upstreams",
    );
    expect(type(upstreams.body.fields, "healthchecks")).toBe("record");
    const plugins = await get<{ fields: Record<string, unknown>[] }>(
      "/schemas/plugins",
    );
    expect(type(plugins.body.fields, "config")).toBe("record");
  });

  it("serves plugin schemas in Kong's fields format", async () => {
    const { body } = await get<{ fields: Record<string, unknown>[] }>(
      "/schemas/plugins/rate-limiting",
    );
    const config = fieldOf(body.fields, "config");
    expect(config.type).toBe("record");
    expect(
      fieldOf(config.fields as Record<string, unknown>[], "policy"),
    ).toMatchObject({
      type: "string",
      default: "local",
    });
    expect((await get("/schemas/plugins/nope")).status).toBe(
      ERR.ADMIN_NOT_FOUND.status,
    );
    expect((await get("/schemas/consumer_group_plugins")).body).toEqual({
      fields: [],
    });
  });
});

describe("schema validation", () => {
  const validate = async (path: string, body: unknown) => {
    const res = await app.request(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return {
      status: res.status,
      body: (await res.json()) as Record<string, unknown>,
    };
  };
  const ok = { message: KONG_COMPAT.validation.ok };

  it("answers Kong's success for valid entities, references unchecked", async () => {
    expect(
      await validate("/schemas/services/validate", {
        name: "svc",
        url: "https://api.example.test/v1",
      }),
    ).toEqual({ status: 200, body: ok });
    // A route referencing a service that doesn't exist: Kong checks the schema only.
    expect(
      await validate("/schemas/routes/validate", {
        name: "r",
        paths: ["/x"],
        service: { id: "0199a3c0-0000-7000-a000-00000000ffff" },
      }),
    ).toMatchObject({ status: 200 });
    expect(
      await validate("/default/schemas/upstreams/validate", {
        name: "pool.internal",
        algorithm: "least-connections",
      }),
    ).toMatchObject({ status: 200 });
    expect(
      await validate("/schemas/keyauth_credentials/validate", { key: "abc" }),
    ).toMatchObject({ status: 200 });
  });

  it("answers Kong's schema violation, with its fields", async () => {
    const { status, body } = await validate("/schemas/services/validate", {
      name: "svc",
      host: "api.example.test",
      port: "not-a-port",
    });
    expect(status).toBe(400);
    expect(body).toMatchObject({
      code: KONG_COMPAT.validation.violationCode,
      name: KONG_COMPAT.validation.violation,
      fields: { port: expect.any(String) },
    });
    expect(body.message).toMatch(/^schema violation \(port: /);
  });

  it("refuses raw secrets where Edgway takes vault references only", async () => {
    const { status, body } = await validate("/schemas/jwt_secrets/validate", {
      key: "issuer",
      secret: "raw",
    });
    expect(status).toBe(400);
    expect(body.fields).toMatchObject({
      secret: expect.stringContaining("vault"),
    });
  });

  it("validates plugins against the gateway's bundle and their schemas", async () => {
    expect(
      await validate("/schemas/plugins/validate", {
        name: "rate-limiting",
        config: { minute: 5 },
      }),
    ).toEqual({ status: 200, body: ok });
    const bad = await validate("/schemas/plugins/validate", {
      name: "rate-limiting",
      config: { minute: "lots" },
    });
    expect(bad.status).toBe(400);
    expect(bad.body.fields).toMatchObject({
      config: { minute: expect.any(String) },
    });
    const unknown = await validate("/schemas/plugins/validate", {
      name: "not-bundled",
    });
    expect(unknown.status).toBe(400);
    expect(unknown.body.fields).toMatchObject({
      name: expect.stringContaining("not-bundled"),
    });
  });

  it("keeps key-sets and keys empty and unwritable, as documented", async () => {
    for (const collection of ["/key-sets", "/keys"]) {
      expect((await get<Page>(collection)).body.data).toEqual([]);
      const res = await app.request(collection, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "signing" }),
      });
      expect(res.status).toBe(ERR.ADMIN_NOT_FOUND.status);
    }
  });

  it("answers 404 for an entity Edgway doesn't have", async () => {
    const { status, body } = await validate("/schemas/key_sets/validate", {
      name: "ks",
    });
    expect(status).toBe(404);
    expect(body.message).toBe("No entity named 'key_sets'");
  });
});
