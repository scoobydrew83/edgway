import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";
import {
  ENTITY_NAMES,
  type EntityName,
  entitySchemas,
  tables,
} from "../../src/index";

const db = drizzle(env.DB);
const ws = "0199a3c0-0000-7000-8000-000000000001";
const uuid = (n: number) =>
  `0199a3c0-0000-7000-8000-${String(n).padStart(12, "0")}`;

/**
 * One Kong-shaped entity per table, in foreign-key order. Field names are
 * Kong's; values follow Kong's Admin API examples.
 */
const SAMPLES: [EntityName, Record<string, unknown>][] = [
  [
    "certificates",
    {
      id: uuid(1),
      workspace_id: ws,
      cert: "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----",
      key: "{vault://env/TLS_KEY}",
      tags: ["tls"],
    },
  ],
  [
    "ca_certificates",
    {
      id: uuid(2),
      workspace_id: ws,
      cert: "-----BEGIN CERTIFICATE-----\nMIIC\n-----END CERTIFICATE-----",
      cert_digest: "a1b2c3",
    },
  ],
  [
    "services",
    {
      id: uuid(3),
      workspace_id: ws,
      name: "httpbin",
      protocol: "https",
      host: "httpbin.org",
      port: 443,
      path: "/anything",
      retries: 3,
      client_certificate_id: uuid(1),
      tls_verify: true,
      ca_certificates: [uuid(2)],
      tags: ["demo"],
    },
  ],
  [
    "routes",
    {
      id: uuid(4),
      workspace_id: ws,
      name: "httpbin-get",
      service_id: uuid(3),
      protocols: ["https"],
      methods: ["GET"],
      hosts: ["api.example.com"],
      paths: ["/demo/httpbin"],
      headers: { "x-env": ["prod"] },
      strip_path: true,
      sources: [{ ip: "10.0.0.0/8" }],
      tags: ["demo"],
    },
  ],
  [
    "upstreams",
    {
      id: uuid(5),
      workspace_id: ws,
      name: "backend.internal",
      algorithm: "consistent-hashing",
      hash_on: "header",
      hash_on_header: "x-user",
      healthchecks: { active: { type: "http", http_path: "/health" } },
    },
  ],
  [
    "targets",
    {
      id: uuid(6),
      workspace_id: ws,
      upstream_id: uuid(5),
      target: "10.0.0.1:8080",
      weight: 50,
    },
  ],
  [
    "snis",
    {
      id: uuid(7),
      workspace_id: ws,
      name: "api.example.com",
      certificate_id: uuid(1),
    },
  ],
  [
    "vaults",
    {
      id: uuid(8),
      workspace_id: ws,
      name: "env",
      prefix: "my-env",
      description: "Environment variables",
      config: { prefix: "EDGWAY_" },
    },
  ],
  [
    "consumers",
    {
      id: uuid(9),
      workspace_id: ws,
      username: "alice",
      custom_id: "cust-1",
      tags: ["gold"],
    },
  ],
  ["consumer_groups", { id: uuid(10), workspace_id: ws, name: "gold" }],
  [
    "consumer_group_consumers",
    { workspace_id: ws, consumer_group_id: uuid(10), consumer_id: uuid(9) },
  ],
  [
    "plugins",
    {
      id: uuid(11),
      workspace_id: ws,
      name: "rate-limiting",
      route_id: uuid(4),
      config: { minute: 30, policy: "local" },
      protocols: ["http", "https"],
      enabled: true,
    },
  ],
  [
    "keyauth_credentials",
    {
      id: uuid(12),
      workspace_id: ws,
      consumer_id: uuid(9),
      key_hash:
        "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
      key_prefix: "edg_9f86",
      ttl: 3600,
    },
  ],
  [
    "basicauth_credentials",
    {
      id: uuid(13),
      workspace_id: ws,
      consumer_id: uuid(9),
      username: "alice",
      password: "5baa61e4c9b93f3f0682250b6cf8331b7ee68fd8",
    },
  ],
  [
    "jwt_secrets",
    {
      id: uuid(14),
      workspace_id: ws,
      consumer_id: uuid(9),
      key: "alice-issuer",
      algorithm: "RS256",
      rsa_public_key:
        "-----BEGIN PUBLIC KEY-----\nMIIB\n-----END PUBLIC KEY-----",
    },
  ],
  [
    "acls",
    { id: uuid(15), workspace_id: ws, consumer_id: uuid(9), group: "admins" },
  ],
  [
    "sandbox_plugins",
    {
      id: uuid(19),
      workspace_id: ws,
      name: "my-guard",
      code: "export async function access() {}",
      bindings: ["CAPABILITY"],
    },
  ],
  [
    "audit_events",
    {
      id: uuid(17),
      workspace_id: ws,
      actor: "drew@example.com",
      action: "create",
      entity_type: "services",
      entity_id: uuid(3),
      request_id: "req-1",
      diff: [{ type: "CREATE", path: ["name"], value: "httpbin" }],
    },
  ],
  [
    "config_versions",
    {
      id: uuid(18),
      workspace_id: ws,
      version: 1,
      sha256:
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      diff: [],
      created_by: "drew@example.com",
    },
  ],
];

describe("entity tables", () => {
  it("has a sample for every table", () => {
    expect(SAMPLES.map(([name]) => name).sort()).toEqual(
      [...ENTITY_NAMES].sort(),
    );
  });

  it("round-trips each Kong entity through D1", async () => {
    for (const [name, sample] of SAMPLES) {
      const table = tables[name];
      const { insert, select } = entitySchemas[name];
      await db.insert(table).values(insert.parse(sample) as never);

      const key = "id" in table ? eq(table.id, sample.id as string) : undefined;
      const [row] = await db.select().from(table).where(key);
      const parsed = select.parse(JSON.parse(JSON.stringify(row)));

      expect(parsed, name).toMatchObject(sample);
      expect(typeof parsed.created_at, name).toBe("number");
    }
  });

  it("fills Kong's defaults", async () => {
    const [route] = await db
      .select()
      .from(tables.routes)
      .where(eq(tables.routes.id, uuid(4)));
    expect(route).toMatchObject({
      https_redirect_status_code: 426,
      regex_priority: 0,
      path_handling: "v0",
      preserve_host: false,
      request_buffering: true,
      response_buffering: true,
    });
    const [service] = await db
      .select()
      .from(tables.services)
      .where(eq(tables.services.id, uuid(3)));
    expect(service).toMatchObject({
      connect_timeout: 60000,
      read_timeout: 60000,
      write_timeout: 60000,
      enabled: true,
    });
  });

  it("generates UUIDv7 ids", async () => {
    const [consumer] = await db
      .insert(tables.consumers)
      .values({ workspace_id: ws, username: "bob" })
      .returning();
    expect(consumer?.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("requires workspace_id on every table", () => {
    for (const name of ENTITY_NAMES) {
      const shape = entitySchemas[name].insert.shape as Record<
        string,
        { safeParse(v: unknown): { success: boolean } }
      >;
      expect(shape.workspace_id?.safeParse(undefined).success, name).toBe(
        false,
      );
    }
  });
});
