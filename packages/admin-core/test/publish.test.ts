import { env, runInDurableObject } from "cloudflare:test";
import { type Snapshot, verifySnapshot } from "@edgway/adapters-cf";
import {
  CONFIG,
  KV_KEY,
  PORTAL,
  PUBLISH_WARNING,
  SANDBOX,
  UPSTREAM,
} from "@edgway/constants";
import { ERR } from "@edgway/errors";
import { tables } from "@edgway/schema";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { generateKeyPair } from "jose";
import { uuidv7 } from "uuidv7";
import { describe, expect, it } from "vitest";
import {
  createAdminCore,
  currentVersion,
  kongCatalog,
  liveVersion,
  type PluginSchema,
  pluginCatalog,
  publishedSnapshot,
} from "../src/index";

const keys = await generateKeyPair("EdDSA");
let n = 0;

/**
 * A third-party plugin's own schema (as `definePlugin` keeps it): its config
 * needs a string `greeting`.
 */
const greetingSchema: PluginSchema = {
  safeParse: (input) =>
    typeof (input as { config: { greeting?: unknown } }).config.greeting ===
    "string"
      ? { success: true }
      : {
          success: false,
          error: {
            issues: [{ path: ["config", "greeting"], message: "Required" }],
          },
        },
};

/**
 * What the test gateway bundles: every vendored Kong plugin (not
 * rate-limiting-advanced, which Edgway doesn't vendor), plus the third-party
 * `greeting` plugin.
 */
const BUNDLED = pluginCatalog([
  ...kongCatalog().values(),
  { name: "greeting", config: greetingSchema },
]);

/** A fresh workspace and KV namespace per test (the pointer is global per KV). */
async function setup() {
  const workspaceId = `0199a3c0-0000-7000-9000-${String(++n).padStart(12, "0")}`;
  const admin = createAdminCore(env.DB, {
    workspaceId,
    actor: "publisher@example.com",
    plugins: BUNDLED,
  });
  // One KV per test: clear the pointer and versions another test wrote.
  const listed = await env.CONFIG_KV.list();
  await Promise.all(listed.keys.map((k) => env.CONFIG_KV.delete(k.name)));
  return {
    admin,
    workspaceId,
    target: { kv: env.CONFIG_KV, signingKey: keys.privateKey },
  };
}

/**
 * A plugin row staged as an older install (or a direct D1 write) could have
 * left it: written past the admin's write-time checks, so publish's
 * own checks are what refuse it.
 */
async function stageRaw(
  workspaceId: string,
  plugin: { name: string; config: Record<string, unknown>; enabled?: boolean },
) {
  const id = uuidv7();
  await drizzle(env.DB)
    .insert(tables.plugins)
    .values({ id, workspace_id: workspaceId, ...plugin } as never);
  return id;
}

async function served(version: number) {
  const stored = await env.CONFIG_KV.get<{
    manifest: string;
    snapshot: string;
  }>(KV_KEY.configVersion(version), "json");
  if (!stored) throw new Error(`no config:v${version}`);
  const verified = await verifySnapshot<Snapshot>(
    stored,
    version,
    keys.publicKey,
  );
  if (typeof verified === "string") throw new Error(verified);
  return verified.config;
}

async function problemStatus(promise: Promise<unknown>) {
  const error = (await promise.then(
    () => undefined,
    (e: unknown) => e,
  )) as { getResponse?: () => Response } | undefined;
  const getResponse = error?.getResponse;
  if (!getResponse) throw new Error("expected an admin problem");
  return getResponse.call(error).status;
}

/** The problem body an admin-core failure would answer with. */
async function problemOf(promise: Promise<unknown>) {
  const error = (await promise.then(
    () => undefined,
    (e: unknown) => e,
  )) as { getResponse?: () => Response } | undefined;
  if (!error?.getResponse) throw new Error("expected an admin problem");
  return error.getResponse().json<Record<string, unknown>>();
}

describe("publish", () => {
  it("signs, writes config:v1 and moves config:current", async () => {
    const { admin, target } = await setup();
    const service = await admin.services.create({ name: "s", host: "a.test" });
    const result = await admin.config.publish(target, "first");
    expect(result.version).toBe(1);
    expect(await currentVersion(env.CONFIG_KV)).toBe(1);
    // The gateway's verifier accepts it: signature, version and digest.
    const snapshot = await served(1);
    expect(snapshot.services.map((s) => s.id)).toEqual([service.id]);
    expect(result.diff).toContainEqual(
      expect.objectContaining({
        type: "CREATE",
        path: ["services", service.id],
      }),
    );

    const [row] = await admin.config.list();
    expect(await admin.config.latest()).toEqual(row);
    expect(row).toMatchObject({
      version: 1,
      sha256: result.sha256,
      created_by: "publisher@example.com",
      note: "first",
    });
    const [event] = await admin.audit.list();
    expect(event).toMatchObject({
      action: "publish",
      entity_type: "config",
      entity_id: "1",
    });
    // Nothing is pending after a publish.
    expect(await admin.pendingDiff(snapshot)).toEqual([]);
  });

  it("numbers versions after the highest published one", async () => {
    const { admin, target } = await setup();
    await admin.services.create({ name: "s", host: "a.test" });
    await admin.config.publish(target);
    await admin.services.update(String((await admin.services.lookup("s")).id), {
      host: "b.test",
    });
    const second = await admin.config.publish(target);
    expect(second.version).toBe(2);
    expect(second.diff.map((d) => d.type)).toEqual(["CHANGE"]);
    expect((await served(2)).services[0]?.host).toBe("b.test");
  });

  it("refuses plugin configs that fail their Kong schema, writing nothing", async () => {
    const { admin, target, workspaceId } = await setup();
    // Refused when written...
    expect(
      await problemStatus(
        admin.plugins.create({
          name: "rate-limiting",
          config: { minute: "lots" },
        }),
      ),
    ).toBe(ERR.ADMIN_INVALID_REQUEST.status);
    // ...and at publish, for a row that got past that.
    await stageRaw(workspaceId, {
      name: "rate-limiting",
      config: { minute: "lots" },
    });
    expect(await problemStatus(admin.config.publish(target))).toBe(
      ERR.ADMIN_INVALID_REQUEST.status,
    );
    expect(await currentVersion(env.CONFIG_KV)).toBeUndefined();
    expect(await admin.config.list()).toEqual([]);
  });

  it("finds the newest version with latest()", async () => {
    const { admin, target } = await setup();
    expect(await admin.config.latest()).toBeUndefined();
    await admin.services.create({ name: "s", host: "a.test" });
    await admin.config.publish(target, "one");
    await admin.services.create({ name: "t", host: "b.test" });
    await admin.config.publish(target, "two");
    await admin.config.publish(target, "three");
    expect(await admin.config.latest()).toMatchObject({
      version: 3,
      note: "three",
    });
  });

  it("publishes least-connections as round-robin and says so", async () => {
    const { admin, target } = await setup();
    const lc = await admin.upstreams.create({
      name: "orders.internal",
      algorithm: "least-connections",
    });
    await admin.upstreams.create({ name: "rr.internal" });
    await admin.upstreams.create({
      name: "hash.internal",
      algorithm: "consistent-hashing",
    });
    const result = await admin.config.publish(target);
    expect(result.version).toBe(1);
    expect(result.warnings).toEqual([
      {
        code: PUBLISH_WARNING.upstreamAlgorithm,
        upstream: String(lc.id),
        name: "orders.internal",
        algorithm: "least-connections",
        runs_as: UPSTREAM.fallbackAlgorithm,
      },
    ]);
  });

  it("warns when a plugin keeps a secret raw where a vault reference would do", async () => {
    const { admin, target } = await setup();
    const raw = await admin.plugins.create({
      name: "openid-connect",
      config: { issuer: "https://idp.example/", client_secret: ["s3cret"] },
    });
    await admin.plugins.create({
      name: "rate-limiting",
      config: {
        minute: 5,
        policy: "redis",
        redis: {
          host: "redis.internal",
          password: "{vault://env/vault-redis}",
        },
      },
    });
    const { warnings } = await admin.config.publish(target);
    // Published anyway; only the raw one is named, and never its value.
    expect(warnings).toEqual([
      {
        code: PUBLISH_WARNING.rawSecret,
        plugin: String(raw.id),
        name: "openid-connect",
        fields: ["client_secret.[]"],
      },
    ]);
    expect(JSON.stringify(warnings)).not.toContain("s3cret");
    expect(await currentVersion(env.CONFIG_KV)).toBe(1);
  });

  it("allows vault references only in fields Kong marks referenceable", async () => {
    const { admin, target } = await setup();
    // openid-connect's client_secret is referenceable: published.
    const oidc = await admin.plugins.create({
      name: "openid-connect",
      config: {
        issuer: "https://idp.example/",
        client_secret: ["{vault://env/vault-oidc-secret}"],
      },
    });
    expect((await admin.config.publish(target)).version).toBe(1);
    // The signed snapshot says where the gateway may resolve it.
    expect((await served(1)).plugins[0]?.vault_paths).toEqual([
      ["client_secret", "[]"],
    ]);
    await admin.plugins.delete(String(oidc.id));
    // request-termination's body isn't: a reference there would send the
    // secret to every client.
    await admin.plugins.create({
      name: "request-termination",
      config: { status_code: 200, body: "{vault://env/vault-openai-key}" },
    });
    const refused = await admin.config.publish(target).then(
      () => undefined,
      (e: { getResponse(): Response }) => e.getResponse(),
    );
    expect(refused?.status).toBe(ERR.ADMIN_INVALID_REQUEST.status);
    expect(await refused?.json()).toMatchObject({
      name: "request-termination",
      vault_references: ["body"],
    });
    expect((await admin.config.list()).map((v) => v.version)).toEqual([1]);
  });

  it("refuses routes the gateway's router can't compile", async () => {
    const { admin, target } = await setup();
    const service = await admin.services.create({ name: "s", host: "a.test" });
    await admin.routes.create({
      name: "internal-only",
      service_id: service.id,
      paths: ["/admin"],
      sources: [{ ip: "10.0.0.0/8" }],
    });
    const refused = await admin.config.publish(target).then(
      () => undefined,
      (e: { getResponse(): Response }) => e.getResponse(),
    );
    expect(refused?.status).toBe(ERR.ADMIN_INVALID_REQUEST.status);
    expect(await refused?.json()).toMatchObject({
      unsupported_routes: [{ unsupported: "sources" }],
    });
    expect(await admin.config.list()).toEqual([]);
  });

  it("refuses plugins without a Kong schema", async () => {
    const { admin, target, workspaceId } = await setup();
    expect(
      await problemStatus(
        admin.plugins.create({ name: "not-a-plugin", config: {} }),
      ),
    ).toBe(ERR.ADMIN_PLUGIN_NOT_ENABLED.status);
    await stageRaw(workspaceId, { name: "not-a-plugin", config: {} });
    expect(await problemStatus(admin.config.publish(target))).toBe(
      ERR.ADMIN_INVALID_REQUEST.status,
    );
  });

  it("refuses an enabled plugin the gateway doesn't bundle", async () => {
    const { admin, target, workspaceId } = await setup();
    // Every vendored Kong plugin is bundled: a plugin Kong ships that
    // Edgway doesn't is refused as unbundled. The write itself is refused
    // since an earlier release, so the row is staged directly.
    expect(
      await problemStatus(
        admin.plugins.create({ name: "rate-limiting-advanced", config: {} }),
      ),
    ).toBe(ERR.ADMIN_PLUGIN_NOT_ENABLED.status);
    const staged = {
      id: await stageRaw(workspaceId, {
        name: "rate-limiting-advanced",
        config: {},
      }),
    };
    const refused = await admin.config.publish(target).then(
      () => undefined,
      (e: { getResponse(): Response }) => e.getResponse(),
    );
    expect(refused?.status).toBe(ERR.ADMIN_INVALID_REQUEST.status);
    expect(await refused?.json()).toMatchObject({ bundled: false });
    // Disabled, an unbundled plugin may stay staged: the gateway skips it.
    await drizzle(env.DB)
      .update(tables.plugins)
      .set({ enabled: false })
      .where(eq(tables.plugins.id, staged.id));
    expect((await admin.config.publish(target)).version).toBeGreaterThan(0);
  });

  it("validates a third-party plugin against its own schema", async () => {
    const { admin, target } = await setup();
    const refused = await admin.plugins
      .create({ name: "greeting", config: {} })
      .then(
        () => undefined,
        (e: { getResponse(): Response }) => e.getResponse(),
      );
    expect(refused?.status).toBe(ERR.ADMIN_INVALID_REQUEST.status);
    expect(await refused?.json()).toMatchObject({
      name: "greeting",
      issues: [{ path: "config.greeting", message: "Required" }],
    });
    await admin.plugins.create({
      name: "greeting",
      config: { greeting: "hi" },
    });
    const published = await admin.config.publish(target);
    expect(published.version).toBeGreaterThan(0);
    expect((await served(published.version)).plugins).toContainEqual(
      expect.objectContaining({ name: "greeting", config: { greeting: "hi" } }),
    );
  });

  it("carries a plugin's on_error in the snapshot", async () => {
    const { admin, target } = await setup();
    await admin.plugins.create({
      name: "acl",
      config: { allow: ["admins"] },
      on_error: "fail-open",
    });
    await admin.config.publish(target);
    expect((await served(1)).plugins[0]).toMatchObject({
      name: "acl",
      on_error: "fail-open",
    });
    expect(
      await problemStatus(
        admin.plugins.create({ name: "acl", config: {}, on_error: "maybe" }),
      ),
    ).toBe(ERR.ADMIN_INVALID_REQUEST.status);
  });

  it("never puts credential hashes in the returned or stored diff", async () => {
    const { admin, target } = await setup();
    const consumer = await admin.consumers.create({ username: "k" });
    const { key } = await admin.keyAuth.create({
      consumer_id: String(consumer.id),
    });
    const result = await admin.config.publish(target);
    const { sha256Hex } = await import("@edgway/core");
    const hash = await sha256Hex(key);
    expect(JSON.stringify(result.diff)).not.toContain(hash);
    expect(JSON.stringify(await admin.config.list())).not.toContain(hash);
    // The data plane still gets the hash it verifies against.
    expect((await served(1)).keyauth_credentials?.[0]?.key_hash).toBe(hash);
  });
});

describe("sandbox plugins", () => {
  const code = (tag: string) =>
    `export async function access() { return { response: new Response("${tag}") }; }`;

  it("publishes uploaded code in the signed snapshot and rolls it back", async () => {
    const { admin, target } = await setup();
    const uploaded = await admin.sandbox_plugins.create({
      name: "my-guard",
      version: "1.0.0",
      priority: 900,
      code: code("v1"),
      cpu_ms: 10,
      bindings: ["CAPABILITY"],
    });
    await admin.plugins.create({ name: "my-guard", config: { mode: "x" } });
    await admin.config.publish(target);
    const first = await served(1);
    expect(first.sandbox_plugins).toEqual([
      {
        id: uploaded.id,
        name: "my-guard",
        version: "1.0.0",
        priority: 900,
        code: code("v1"),
        cpu_ms: 10,
        bindings: ["CAPABILITY"],
      },
    ]);
    expect(first.plugins[0]).toMatchObject({ name: "my-guard" });

    await admin.sandbox_plugins.update(String(uploaded.id), {
      version: "1.0.1",
      code: code("v2"),
    });
    const [pending] = await admin.audit.list();
    expect(pending).toMatchObject({
      action: "update",
      entity_type: "sandbox_plugins",
    });
    await admin.config.publish(target);
    expect((await served(2)).sandbox_plugins?.[0]?.code).toBe(code("v2"));

    await admin.config.rollback(target, 1);
    expect(await currentVersion(env.CONFIG_KV)).toBe(1);
    expect((await served(1)).sandbox_plugins?.[0]?.code).toBe(code("v1"));
  });

  it("refuses vault references in an uploaded plugin's config", async () => {
    const { admin, target } = await setup();
    await admin.sandbox_plugins.create({
      name: "leaky",
      version: "1.0.0",
      priority: 900,
      code: code("v1"),
    });
    await admin.plugins.create({
      name: "leaky",
      config: { token: "{vault://env/vault-openai-key}" },
    });
    expect(await problemStatus(admin.config.publish(target))).toBe(
      ERR.ADMIN_INVALID_REQUEST.status,
    );
  });

  it("refuses a bundled plugin's name and oversized code", async () => {
    const { admin } = await setup();
    expect(
      await problemStatus(
        admin.sandbox_plugins.create({ name: "key-auth", code: code("x") }),
      ),
    ).toBe(ERR.ADMIN_INVALID_REQUEST.status);
    expect(
      await problemStatus(
        admin.sandbox_plugins.create({
          name: "big",
          code: "x".repeat(SANDBOX.maxCodeBytes + 1),
        }),
      ),
    ).toBe(ERR.ADMIN_INVALID_REQUEST.status);
  });

  it("refuses an uploaded plugin's instance whose config isn't an object", async () => {
    const { admin, target } = await setup();
    await admin.sandbox_plugins.create({ name: "mine", code: code("x") });
    await admin.plugins.create({ name: "mine", config: [] as never });
    expect(await problemStatus(admin.config.publish(target))).toBe(
      ERR.ADMIN_INVALID_REQUEST.status,
    );
  });
});

describe("revocations", () => {
  it("only take away from the live config", async () => {
    const { admin, target } = await setup();
    const consumer = await admin.consumers.create({ username: "revokee" });
    const id = String(consumer.id);
    const deleted = await admin.keyAuth.create({ consumer_id: id });
    const rotated = await admin.keyAuth.create({ consumer_id: id });
    const kept = await admin.keyAuth.create({ consumer_id: id });
    // A group an acl `deny` list names: removing it would grant access.
    const denied = await admin.acls.create({
      consumer_id: id,
      group: "banned",
    });
    const first = await admin.config.publish(target);

    // An editor stages more than a revocation for the consumer.
    await admin.acls.create({ consumer_id: id, group: "gold" });
    await admin.acls.delete(String(denied.id));
    await admin.consumers.update(id, { username: "renamed" });
    const extra = await admin.keyAuth.create({ consumer_id: id });
    await admin.keyAuth.delete(String(deleted.credential.id));
    await admin.keyAuth.rotate(String(rotated.credential.id));

    const { version } = await admin.config.publishRevocations(target, [id]);
    const live = (await publishedSnapshot(env.CONFIG_KV, version)) as Snapshot;
    const before = (await publishedSnapshot(
      env.CONFIG_KV,
      first.version,
    )) as Snapshot;
    const keys = new Map(
      (live.keyauth_credentials ?? []).map((k) => [k.id, k.key_hash]),
    );
    const old = new Map(
      (before.keyauth_credentials ?? []).map((k) => [k.id, k.key_hash]),
    );
    const keyId = (k: { credential: Record<string, unknown> }) =>
      String(k.credential.id);
    // The deleted key is gone; the rotated one has its new hash.
    expect(keys.has(keyId(deleted))).toBe(false);
    expect(keys.get(keyId(rotated))).not.toBe(old.get(keyId(rotated)));
    expect(keys.has(keyId(rotated))).toBe(true);
    expect(keys.get(keyId(kept))).toBe(old.get(keyId(kept)));
    // Nothing else staged went live: no new key, ACL or username.
    expect(keys.has(keyId(extra))).toBe(false);
    // ACLs are untouched: no new group, and the deny group stays.
    expect(live.acls ?? []).toEqual(before.acls ?? []);
    expect((live.acls ?? []).map((a) => a.group)).toContain("banned");
    expect(live.consumers.find((c) => c.id === id)?.username).toBe("revokee");

    // A deleted consumer leaves the live config, with its credentials.
    await admin.consumers.delete(id);
    const gone = await admin.config.publishRevocations(target, [id]);
    const after = (await publishedSnapshot(
      env.CONFIG_KV,
      gone.version,
    )) as Snapshot;
    expect(after.consumers.some((c) => c.id === id)).toBe(false);
    expect(
      (after.keyauth_credentials ?? []).some((k) => k.consumer_id === id),
    ).toBe(false);
    expect((after.acls ?? []).some((a) => a.consumer_id === id)).toBe(false);
  });
});

describe("rollback", () => {
  it("lists the credentials it revives: deleted or rotated since", async () => {
    const { admin, target } = await setup();
    const consumer = await admin.consumers.create({ username: "revived" });
    const id = String(consumer.id);
    const kept = await admin.keyAuth.create({ consumer_id: id });
    const deleted = await admin.keyAuth.create({ consumer_id: id });
    const rotated = await admin.keyAuth.create({ consumer_id: id });
    await admin.acls.create({ consumer_id: id, group: "gold" });
    const first = await admin.config.publish(target);
    await admin.keyAuth.delete(String(deleted.credential.id));
    await admin.keyAuth.rotate(String(rotated.credential.id));
    const { data: acls } = await admin.acls.list({
      where: { consumer_id: id },
    });
    for (const acl of acls) await admin.acls.delete(String(acl.id));
    await admin.config.publish(target);

    // A dry run says the same, and moves nothing.
    const live = await currentVersion(env.CONFIG_KV);
    const preview = await admin.config.rollback(target, first.version, {
      dryRun: true,
    });
    expect(await currentVersion(env.CONFIG_KV)).toBe(live);

    const { revived } = await admin.config.rollback(target, first.version);
    expect(revived).toEqual(preview.revived);
    expect(revived).toEqual(
      expect.arrayContaining([
        {
          entity: "keyauth_credentials",
          id: String(deleted.credential.id),
          consumer_id: id,
        },
        {
          entity: "keyauth_credentials",
          id: String(rotated.credential.id),
          consumer_id: id,
        },
        { entity: "acls", id: `${id}:gold`, consumer_id: id },
      ]),
    );
    expect(revived.map((r) => r.id)).not.toContain(String(kept.credential.id));
    expect(revived).toHaveLength(3);
  });

  it("moves the pointer back; the next publish continues the numbering", async () => {
    const { admin, target } = await setup();
    await admin.services.create({ name: "s", host: "a.test" });
    await admin.config.publish(target);
    await admin.services.create({ name: "t", host: "t.test" });
    await admin.config.publish(target);

    expect(await admin.config.rollback(target, 1)).toEqual({
      version: 1,
      from: 2,
      revived: [],
    });
    expect(await currentVersion(env.CONFIG_KV)).toBe(1);
    const [event] = await admin.audit.list();
    expect(event).toMatchObject({ action: "rollback", entity_id: "1" });

    const next = await admin.config.publish(target);
    expect(next.version).toBe(3);
  });

  it("refuses unknown versions", async () => {
    const { admin, target } = await setup();
    await admin.config.publish(target);
    expect(await problemStatus(admin.config.rollback(target, 99))).toBe(
      ERR.ADMIN_NOT_FOUND.status,
    );
    expect(await currentVersion(env.CONFIG_KV)).toBe(1);
  });
});

describe("publishConsumer (credential-only, the developer portal)", () => {
  it("publishes one consumer's keys and nothing else staged", async () => {
    const { admin, target } = await setup();
    const service = await admin.services.create({
      name: "live",
      host: "a.test",
    });
    await admin.config.publish(target);
    // Staged by an admin, not published: a new service.
    await admin.services.create({ name: "draft", host: "b.test" });
    const dev = await admin.consumers.create({ custom_id: "oidc|dev" });
    const other = await admin.consumers.create({ username: "other" });
    const { credential } = await admin.keyAuth.create({
      consumer_id: String(dev.id),
    });
    await admin.keyAuth.create({ consumer_id: String(other.id) });

    const result = await admin.config.publishConsumer(target, String(dev.id));
    expect(result.version).toBe(2);
    const snapshot = await served(2);
    expect(snapshot.services.map((s) => s.id)).toEqual([service.id]);
    expect(snapshot.consumers.map((c) => c.id)).toEqual([dev.id]);
    expect(snapshot.keyauth_credentials?.map((k) => k.id)).toEqual([
      credential.id,
    ]);
  });

  it("publishes several consumers' keys in one version", async () => {
    const { admin, target } = await setup();
    const a = await admin.consumers.create({ username: "batch-a" });
    const b = await admin.consumers.create({ username: "batch-b" });
    await admin.keyAuth.create({ consumer_id: String(a.id) });
    await admin.keyAuth.create({ consumer_id: String(b.id) });
    await admin.services.create({ name: "staged-only", host: "s.test" });
    const { version } = await admin.config.publishConsumers(target, [
      String(a.id),
      String(b.id),
    ]);
    const live = await served(version);
    expect(live.consumers.map((c) => c.username).sort()).toEqual([
      "batch-a",
      "batch-b",
    ]);
    expect(live.keyauth_credentials).toHaveLength(2);
    // Nothing else staged goes live.
    expect(live.services).toEqual([]);
  });

  it("removes a deleted key and keeps other consumers' published keys", async () => {
    const { admin, target } = await setup();
    const dev = await admin.consumers.create({ custom_id: "oidc|dev" });
    const other = await admin.consumers.create({ username: "other" });
    const mine = await admin.keyAuth.create({ consumer_id: String(dev.id) });
    const theirs = await admin.keyAuth.create({
      consumer_id: String(other.id),
    });
    await admin.config.publish(target);

    await admin.keyAuth.delete(String(mine.credential.id));
    await admin.config.publishConsumer(target, String(dev.id));
    const snapshot = await served(2);
    expect(snapshot.keyauth_credentials?.map((k) => k.id)).toEqual([
      theirs.credential.id,
    ]);
    expect(snapshot.consumers.map((c) => c.id).sort()).toEqual(
      [dev.id, other.id].sort(),
    );
  });
});

describe("publish integrity", () => {
  /** A target with the ConfigVersion DO and the public key, as the admin and portal have. */
  async function withVersions() {
    const { admin, target, workspaceId } = await setup();
    const object = env.CONFIG_VERSION.get(
      env.CONFIG_VERSION.idFromName(CONFIG.versionObjectName),
    );
    // One DO per test file: clear what an earlier test reserved.
    await runInDurableObject(object, (_instance, state) =>
      state.storage.deleteAll(),
    );
    return {
      admin,
      object,
      workspaceId,
      target: {
        ...target,
        publicKey: keys.publicKey,
        versions: env.CONFIG_VERSION,
      },
    };
  }

  it("never loses a version when the admin and the portal publish at once", async () => {
    const { admin, object, target } = await withVersions();
    await admin.services.create({ name: "staged-service", host: "a.test" });
    const consumer = await admin.consumers.create({ username: "dev" });
    await admin.keyAuth.create({ consumer_id: String(consumer.id) });
    const results = await Promise.all([
      admin.config.publish(target),
      admin.config.publishConsumer(target, String(consumer.id)),
    ]);
    // Two versions, each recorded; a lost claim leaves its number unused.
    const published = results.map((r) => r.version).sort((a, b) => a - b);
    expect(new Set(published).size).toBe(2);
    const last = Math.max(...published);
    expect(await object.current()).toBe(last);
    expect(await currentVersion(env.CONFIG_KV)).toBe(last);
    expect(
      (await admin.config.list()).map((v) => v.version).sort((a, b) => a - b),
    ).toEqual(published);
    // Whichever came second built on the first: both changes are live.
    const live = await served(last);
    expect(live.services.map((s) => s.name)).toContain("staged-service");
    expect(live.keyauth_credentials).toHaveLength(1);
  });

  it("leaves KV's pointer on the live version when publishes finish out of order", async () => {
    const { admin, object, target, workspaceId } = await withVersions();
    await admin.services.create({ name: "s1", host: "a.test" });
    // The first publish is held after its claim, while it records its row;
    // a second publish goes live and finishes in the meantime.
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let claimed: () => void = () => {};
    const isClaimed = new Promise<void>((resolve) => {
      claimed = resolve;
    });
    const slow = new Proxy(env.DB, {
      get(db, key) {
        if (key === "batch") {
          return async (statements: D1PreparedStatement[]) => {
            claimed();
            await held;
            return db.batch(statements);
          };
        }
        const value = Reflect.get(db, key);
        return typeof value === "function" ? value.bind(db) : value;
      },
    });
    const slowAdmin = createAdminCore(slow, {
      workspaceId,
      actor: "publisher@example.com",
    });
    const one = slowAdmin.config.publish(target);
    await isClaimed;
    const two = await admin.config.publish(target);
    release();
    expect((await one).version).toBeLessThan(two.version);
    expect(await object.current()).toBe(two.version);
    expect(await currentVersion(env.CONFIG_KV)).toBe(two.version);
  });

  it("refuses to build on a tampered live snapshot (the portal's publish)", async () => {
    const { admin, target } = await withVersions();
    const consumer = await admin.consumers.create({ username: "dev2" });
    await admin.config.publish(target);
    const stored = await env.CONFIG_KV.get<{
      manifest: string;
      snapshot: string;
    }>(KV_KEY.configVersion(1), "json");
    const planted = JSON.parse(stored?.snapshot ?? "{}");
    planted.sandbox_plugins = [{ name: "planted", code: "evil" }];
    await env.CONFIG_KV.put(
      KV_KEY.configVersion(1),
      JSON.stringify({ ...stored, snapshot: JSON.stringify(planted) }),
    );
    expect(
      await problemStatus(
        admin.config.publishConsumer(target, String(consumer.id)),
      ),
    ).toBe(ERR.ADMIN_PUBLISHED_INVALID.status);
    expect(await currentVersion(env.CONFIG_KV)).toBe(1);
  });

  it("moves the DO on publish and rollback", async () => {
    const { admin, object, target } = await withVersions();
    await admin.services.create({ name: "s1", host: "a.test" });
    await admin.config.publish(target);
    await admin.services.create({ name: "s2", host: "b.test" });
    await admin.config.publish(target);
    expect(await object.current()).toBe(2);
    await admin.config.rollback(target, 1);
    expect(await object.current()).toBe(1);
    expect(await currentVersion(env.CONFIG_KV)).toBe(1);
  });

  it("rebuilds from the new live version when a portal publish wins the race", async () => {
    const { admin, object, target } = await withVersions();
    await admin.services.create({ name: "s1", host: "a.test" });
    const consumer = await admin.consumers.create({ username: "racer" });
    // The portal publishes while the admin's publish is between its build
    // and its claim (the DO call that hands out the admin's number).
    let portal: (() => Promise<unknown>) | undefined = async () => {
      await admin.keyAuth.create({ consumer_id: String(consumer.id) });
      await admin.config.publishConsumer(target, String(consumer.id));
    };
    const racing = {
      idFromName: (name: string) => env.CONFIG_VERSION.idFromName(name),
      get: (id: DurableObjectId) => {
        const real = env.CONFIG_VERSION.get(id);
        return {
          current: () => real.current(),
          compareAndSet: (a?: number, b?: number) => real.compareAndSet(a, b),
          allocate: async (floor?: number) => {
            const run = portal;
            portal = undefined;
            await run?.();
            return real.allocate(floor);
          },
        };
      },
    } as unknown as typeof env.CONFIG_VERSION;
    const result = await admin.config.publish({ ...target, versions: racing });
    // The portal's publish took 1; the admin lost its claim, rebuilt with the
    // new key, and went live as the next number.
    expect(result.version).toBeGreaterThan(1);
    expect(await object.current()).toBe(result.version);
    const live = await served(result.version);
    expect(live.services.map((s) => s.name)).toContain("s1");
    expect(live.keyauth_credentials).toHaveLength(1);
  });

  it("never reuses a version number after a rollback", async () => {
    const { admin, object, target } = await withVersions();
    await admin.services.create({ name: "s1", host: "a.test" });
    await admin.config.publish(target);
    await admin.services.create({ name: "s2", host: "b.test" });
    await admin.config.publish(target);
    const second = await env.CONFIG_KV.get(KV_KEY.configVersion(2));
    await admin.config.rollback(target, 1);
    // The DO hands out 3, not 2 again: config:v2 is never overwritten.
    await admin.services.create({ name: "s3", host: "c.test" });
    expect((await admin.config.publish(target)).version).toBe(3);
    expect(await object.current()).toBe(3);
    expect(await env.CONFIG_KV.get(KV_KEY.configVersion(2))).toBe(second);
    expect((await admin.config.list()).map((v) => v.version)).toEqual([
      3, 2, 1,
    ]);
  });

  it("refuses the portal's publish while the live snapshot isn't readable (503)", async () => {
    const { admin, object, target } = await withVersions();
    const consumer = await admin.consumers.create({ username: "dev3" });
    await admin.services.create({ name: "s1", host: "a.test" });
    await admin.config.publish(target);
    // This colo's KV hasn't got config:v1 yet (KV is eventually consistent).
    await env.CONFIG_KV.delete(KV_KEY.configVersion(1));
    expect(
      await problemStatus(
        admin.config.publishConsumer(target, String(consumer.id)),
      ),
    ).toBe(ERR.CONFIG_UNAVAILABLE.status);
    expect(await object.current()).toBe(1);
    expect((await admin.config.list()).map((v) => v.version)).toEqual([1]);
  });

  it("gives the live version back when the publish can't be written", async () => {
    const { admin, object, target } = await withVersions();
    await admin.services.create({ name: "s1", host: "a.test" });
    await admin.config.publish(target);
    const failing = {
      ...target,
      kv: {
        get: env.CONFIG_KV.get.bind(env.CONFIG_KV),
        put: async () => {
          throw new Error("KV unavailable");
        },
      } as unknown as KVNamespace,
    };
    await expect(admin.config.publish(failing)).rejects.toThrow(
      "KV unavailable",
    );
    // Still version 1 live, with its row; the next publish gets a new number.
    expect(await object.current()).toBe(1);
    expect((await admin.config.list()).map((v) => v.version)).toEqual([1]);
    expect((await admin.config.publish(target)).version).toBe(3);
  });

  it("gives the live version back when the version row can't be recorded", async () => {
    const { admin, object, target } = await withVersions();
    await admin.services.create({ name: "s1", host: "a.test" });
    await admin.config.publish(target);
    // The same workspace through a D1 whose batch (the row + audit) fails.
    const [first] = await admin.config.list();
    const failing = new Proxy(env.DB, {
      get(db, key) {
        if (key === "batch") {
          return async () => {
            throw new Error("D1 unavailable");
          };
        }
        const value = Reflect.get(db, key);
        return typeof value === "function" ? value.bind(db) : value;
      },
    });
    const broken = createAdminCore(failing, {
      workspaceId: String(first?.workspace_id),
      actor: "publisher@example.com",
    });
    await expect(broken.config.publish(target)).rejects.toThrow(
      "D1 unavailable",
    );
    expect(await object.current()).toBe(1);
    expect(await currentVersion(env.CONFIG_KV)).toBe(1);
    expect((await admin.config.list()).map((v) => v.version)).toEqual([1]);
  });

  it("reads the live version from the DO only, never KV's pointer, when bound", async () => {
    const { admin, target } = await withVersions();
    // A pointer planted in KV with the DO empty (or after an upgrade).
    await env.CONFIG_KV.put(
      KV_KEY.configCurrent,
      JSON.stringify({ version: 7 }),
    );
    expect(await liveVersion(target)).toBeUndefined();
    expect(await liveVersion({ kv: env.CONFIG_KV })).toBe(7);
    await admin.services.create({ name: "s1", host: "a.test" });
    // Numbering follows the recorded versions, not the planted pointer.
    const { version } = await admin.config.publish(target);
    expect(version).toBe(1);
    expect(await liveVersion(target)).toBe(1);
    expect(await currentVersion(env.CONFIG_KV)).toBe(1);
  });

  it("refuses the portal's publish while a new DO has no live version (503)", async () => {
    const { admin, object, target } = await withVersions();
    const consumer = await admin.consumers.create({ username: "upgrade" });
    await admin.services.create({ name: "s1", host: "a.test" });
    await admin.config.publish(target);
    // An upgrade: versions were published before the DO held them.
    await runInDurableObject(object, (_instance, state) =>
      state.storage.deleteAll(),
    );
    await admin.keyAuth.create({ consumer_id: String(consumer.id) });
    expect(
      await problemStatus(
        admin.config.publishConsumer(target, String(consumer.id)),
      ),
    ).toBe(ERR.CONFIG_UNAVAILABLE.status);
    expect(await object.current()).toBeUndefined();
    // The admin's full publish makes the config live again, then the portal's works.
    await admin.config.publish(target);
    const portal = await admin.config.publishConsumer(
      target,
      String(consumer.id),
    );
    const live = await served(portal.version);
    expect(live.services.map((s) => s.name)).toContain("s1");
    expect(live.keyauth_credentials).toHaveLength(1);
  });

  it("answers 409 recorded:false when the row fails and another publish already moved on", async () => {
    const { admin, object, target, workspaceId } = await withVersions();
    await admin.services.create({ name: "s1", host: "a.test" });
    await admin.config.publish(target);
    // This publish's row can't be recorded; while it fails, another
    // publish takes the live version, so it can't be given back.
    let moved: number | undefined;
    const failing = new Proxy(env.DB, {
      get(db, key) {
        if (key === "batch") {
          return async () => {
            moved = (await admin.config.publish(target)).version;
            throw new Error("D1 unavailable");
          };
        }
        const value = Reflect.get(db, key);
        return typeof value === "function" ? value.bind(db) : value;
      },
    });
    const broken = createAdminCore(failing, {
      workspaceId,
      actor: "publisher@example.com",
    });
    const error = (await broken.config.publish(target).then(
      () => undefined,
      (e: unknown) => e,
    )) as { getResponse?: () => Response } | undefined;
    const res = error?.getResponse?.call(error);
    expect(res?.status).toBe(ERR.ADMIN_PUBLISH_CONFLICT.status);
    expect(await res?.json()).toMatchObject({
      code: ERR.ADMIN_PUBLISH_CONFLICT.code,
      recorded: false,
      version: 2,
    });
    // The other publish stays live, with its row; version 2 has none.
    expect(moved).toBe(3);
    expect(await object.current()).toBe(3);
    expect((await admin.config.list()).map((v) => v.version)).toEqual([3, 1]);
  });
});

describe("retention", () => {
  /** Published versions as an older install left them: rows and snapshots. */
  async function seedVersions(
    workspaceId: string,
    count: number,
    recent: Set<number> = new Set(),
  ) {
    const db = drizzle(env.DB);
    const old = Math.floor(Date.now() / 1000) - CONFIG.retainSeconds - 3600;
    for (let version = 1; version <= count; version++) {
      await db.insert(tables.config_versions).values({
        id: uuidv7(),
        workspace_id: workspaceId,
        version,
        sha256: "seeded",
        created_by: "seed",
        created_at: recent.has(version) ? Math.floor(Date.now() / 1000) : old,
      });
      await env.CONFIG_KV.put(KV_KEY.configVersion(version), "{}");
    }
  }

  it("keeps the newest versions, the last week's and the live one; refuses a rollback past them", async () => {
    const { admin, target, workspaceId } = await setup();
    const seeded = CONFIG.retainVersions + 5;
    // Version 3 is recent: kept although it's old by number.
    await seedVersions(workspaceId, seeded, new Set([3]));
    const { version } = await admin.config.publish(target);
    expect(version).toBe(seeded + 1);

    const kept = (await admin.config.list()).map((v) => v.version);
    // The newest retainVersions (7…106 of 1…106), plus the recent 3.
    expect(kept).toContain(version);
    expect(kept).toContain(3);
    for (const pruned of [1, 2, 4, 5, 6]) {
      expect(kept).not.toContain(pruned);
      expect(await env.CONFIG_KV.get(KV_KEY.configVersion(pruned))).toBeNull();
    }
    expect(kept).toHaveLength(CONFIG.retainVersions + 1);
    expect(await env.CONFIG_KV.get(KV_KEY.configVersion(3))).not.toBeNull();

    expect(await problemOf(admin.config.rollback(target, 2))).toMatchObject({
      code: ERR.ADMIN_VERSION_PRUNED.code,
      status: ERR.ADMIN_VERSION_PRUNED.status,
      oldest: 3,
    });
  });
});

// This test seeds a full retention window and publishes twice. It takes
// 3-5 s on CI, too close to vitest's 5 s default, so it gets more room.
const RETENTION_TEST_TIMEOUT_MS = 15_000;

describe("retention after a failed snapshot delete", () => {
  it(
    "keeps the row until its snapshot is gone, so the next publish retries",
    async () => {
      const { admin, target, workspaceId } = await setup();
      const db = drizzle(env.DB);
      const old = Math.floor(Date.now() / 1000) - CONFIG.retainSeconds - 3600;
      for (let version = 1; version <= CONFIG.retainVersions + 2; version++) {
        await db.insert(tables.config_versions).values({
          id: uuidv7(),
          workspace_id: workspaceId,
          version,
          sha256: "seeded",
          created_by: "seed",
          created_at: old,
        });
        await env.CONFIG_KV.put(KV_KEY.configVersion(version), "{}");
      }
      // KV refuses to delete version 1's snapshot, once.
      let refuse = true;
      const flaky = {
        ...target,
        kv: new Proxy(env.CONFIG_KV, {
          get(kv, prop) {
            if (prop === "delete") {
              return async (key: string) => {
                if (refuse && key === KV_KEY.configVersion(1)) {
                  refuse = false;
                  throw new Error("KV unavailable");
                }
                return kv.delete(key);
              };
            }
            const value = Reflect.get(kv, prop);
            return typeof value === "function" ? value.bind(kv) : value;
          },
        }),
      };
      await admin.config.publish(flaky);
      let kept = (await admin.config.list()).map((v) => v.version);
      // Version 2 went (snapshot and row); version 1's row stays for a retry.
      expect(kept).not.toContain(2);
      expect(await env.CONFIG_KV.get(KV_KEY.configVersion(2))).toBeNull();
      expect(kept).toContain(1);
      expect(await env.CONFIG_KV.get(KV_KEY.configVersion(1))).not.toBeNull();

      await admin.config.publish(flaky);
      kept = (await admin.config.list()).map((v) => v.version);
      expect(kept).not.toContain(1);
      expect(await env.CONFIG_KV.get(KV_KEY.configVersion(1))).toBeNull();
    },
    RETENTION_TEST_TIMEOUT_MS,
  );
});

describe("an admin publish racing portal batches", () => {
  /** A ConfigVersion stand-in whose compare-and-set loses `losses` times. */
  function racingTarget(workspaceId: string, losses: number, winner: string) {
    const db = drizzle(env.DB);
    let live: number | undefined;
    let next = 1_000;
    let left = losses;
    const object = {
      current: async () => live,
      allocate: async (floor: number) => {
        next = Math.max(next, floor) + 1;
        return next;
      },
      compareAndSet: async (expected: number | undefined, to: number) => {
        if (left > 0) {
          left--;
          // Another publish wins first: its row is recorded.
          next++;
          live = next;
          await db.insert(tables.config_versions).values({
            id: uuidv7(),
            workspace_id: workspaceId,
            version: live,
            sha256: "other",
            created_by: winner,
          });
          return false;
        }
        if (expected !== live) return false;
        live = to;
        return true;
      },
    };
    const versions = {
      idFromName: () => "live",
      get: () => object,
    } as unknown as Parameters<
      ReturnType<typeof createAdminCore>["config"]["publish"]
    >[0]["versions"];
    return versions;
  }

  it("retries past portal batches, but not past other publishes", async () => {
    const portal = await setup();
    const losses = CONFIG.publishAttempts + 2;
    const published = await portal.admin.config.publish({
      ...portal.target,
      versions: racingTarget(portal.workspaceId, losses, PORTAL.actor),
    });
    expect(published.version).toBeGreaterThan(0);

    const other = await setup();
    const conflict = await problemOf(
      other.admin.config.publish({
        ...other.target,
        versions: racingTarget(other.workspaceId, losses, "admin@example.com"),
      }),
    );
    expect(conflict.code).toBe(ERR.ADMIN_PUBLISH_CONFLICT.code);
  });
});

describe("retention racing a rollback", () => {
  /** Old versions with readable (unsigned) snapshots, as rollback reads them. */
  async function seedOld(workspaceId: string, count: number) {
    const db = drizzle(env.DB);
    const old = Math.floor(Date.now() / 1000) - CONFIG.retainSeconds - 3600;
    const stored = JSON.stringify({ manifest: "seeded", snapshot: "{}" });
    for (let version = 1; version <= count; version++) {
      await db.insert(tables.config_versions).values({
        id: uuidv7(),
        workspace_id: workspaceId,
        version,
        sha256: "seeded",
        created_by: "seed",
        created_at: old,
      });
      await env.CONFIG_KV.put(KV_KEY.configVersion(version), stored);
    }
    return stored;
  }

  it("a prune keeps a version a rollback made live during it", async () => {
    const { admin, target, workspaceId } = await setup();
    const stored = await seedOld(workspaceId, CONFIG.retainVersions + 2);
    // Version 1 goes live (a rollback) after prune checked the live
    // version, just before prune deletes its snapshot.
    let raced = false;
    const racing = {
      ...target,
      kv: new Proxy(env.CONFIG_KV, {
        get(kv, prop) {
          if (prop === "delete") {
            return async (key: string) => {
              if (!raced && key === KV_KEY.configVersion(1)) {
                raced = true;
                await admin.config.rollback(target, 1);
              }
              return kv.delete(key);
            };
          }
          const value = Reflect.get(kv, prop);
          return typeof value === "function" ? value.bind(kv) : value;
        },
      }),
    };
    await admin.config.publish(racing);
    expect(raced).toBe(true);
    expect(await liveVersion(target)).toBe(1);
    // The live version keeps its snapshot and its row; version 2 still went.
    expect(await env.CONFIG_KV.get(KV_KEY.configVersion(1))).toBe(stored);
    const kept = (await admin.config.list()).map((v) => v.version);
    expect(kept).toContain(1);
    expect(kept).not.toContain(2);
    expect(await env.CONFIG_KV.get(KV_KEY.configVersion(2))).toBeNull();
  });

  it("a rollback puts back a snapshot a prune deleted after it was checked", async () => {
    const { admin, target, workspaceId } = await setup();
    const stored = await seedOld(workspaceId, 2);
    // A prune deletes version 1's snapshot right after the rollback read it.
    let raced = false;
    const racing = {
      ...target,
      kv: new Proxy(env.CONFIG_KV, {
        get(kv, prop) {
          if (prop === "get") {
            return async (key: string, type?: "json") => {
              const value = await kv.get(key, type as never);
              if (!raced && key === KV_KEY.configVersion(1)) {
                raced = true;
                await kv.delete(key);
              }
              return value;
            };
          }
          const value = Reflect.get(kv, prop);
          return typeof value === "function" ? value.bind(kv) : value;
        },
      }),
    };
    expect((await admin.config.rollback(racing, 1)).version).toBe(1);
    expect(raced).toBe(true);
    expect(await liveVersion(target)).toBe(1);
    expect(await env.CONFIG_KV.get(KV_KEY.configVersion(1))).toBe(stored);
  });
});
