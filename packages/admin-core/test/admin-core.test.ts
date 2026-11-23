import { env } from "cloudflare:test";
import { ADMIN_DIFF, API_KEY, SANDBOX } from "@edgway/constants";
import { sha1Hex, sha256Hex } from "@edgway/core";
import { ERR } from "@edgway/errors";
import { PLUGIN_NAMES } from "@edgway/schema";
import { describe, expect, it } from "vitest";
import {
  basicAuthHash,
  createAdminCore,
  pluginSecretPaths,
  redactRow,
  snapshotDiff,
} from "../src/index";

let workspaces = 0;
/** A fresh workspace per test: tests share one D1 database. */
const workspace = () =>
  `0199a3c0-0000-7000-8000-${String(++workspaces).padStart(12, "0")}`;

const core = (workspaceId = workspace(), actor = "drew@example.com") =>
  createAdminCore(env.DB, { workspaceId, actor, requestId: "req-1" });

/** The problem+json response an admin call rejects with. */
async function rejection(promise: Promise<unknown>) {
  const error = (await promise.then(
    () => undefined,
    (e: unknown) => e,
  )) as { getResponse?: () => Response } | undefined;
  const getResponse = error?.getResponse;
  if (!getResponse) throw new Error("expected an admin problem");
  const res = getResponse.call(error);
  return {
    status: res.status,
    body: await res.json<Record<string, unknown>>(),
  };
}

describe("entity CRUD", () => {
  it("creates, reads, updates and deletes a service with UUIDv7 ids", async () => {
    const admin = core();
    const created = await admin.services.create({
      name: "httpbin",
      host: "httpbin.org",
      protocol: "https",
      port: 443,
    });
    expect(created.id).toMatch(/^[0-9a-f-]{8}-[0-9a-f]{4}-7/);
    expect(created.retries).toBe(5); // Kong's default
    expect(await admin.services.get(String(created.id))).toMatchObject({
      host: "httpbin.org",
    });
    expect(await admin.services.lookup("httpbin")).toMatchObject({
      id: created.id,
    });

    const updated = await admin.services.update(String(created.id), {
      path: "/anything",
    });
    expect(updated).toMatchObject({ host: "httpbin.org", path: "/anything" });

    await admin.services.delete(String(created.id));
    const gone = await rejection(admin.services.get(String(created.id)));
    expect(gone.status).toBe(ERR.ADMIN_NOT_FOUND.status);
    expect(gone.body.code).toBe(ERR.ADMIN_NOT_FOUND.code);
  });

  it("replaces on PUT-style updates", async () => {
    const admin = core();
    const s = await admin.services.create({
      name: "svc",
      host: "a.test",
      path: "/x",
      retries: 9,
    });
    const replaced = await admin.services.update(
      String(s.id),
      { name: "svc", host: "b.test" },
      true,
    );
    // Omitted fields go back to Kong's defaults, or null.
    expect(replaced).toMatchObject({ host: "b.test", path: null, retries: 5 });
    expect(replaced.created_at).toBe(s.created_at);
  });

  it("rejects invalid rows with 400 and the issues", async () => {
    const res = await rejection(core().services.create({ name: "no-host" }));
    expect(res.status).toBe(ERR.ADMIN_INVALID_REQUEST.status);
    expect(JSON.stringify(res.body.issues)).toContain("host");
  });

  it("maps unique and foreign-key violations", async () => {
    const admin = core();
    await admin.services.create({ name: "dup", host: "a.test" });
    const dup = await rejection(
      admin.services.create({ name: "dup", host: "b.test" }),
    );
    expect(dup.status).toBe(ERR.ADMIN_CONFLICT.status);
    const fk = await rejection(
      admin.routes.create({
        paths: ["/x"],
        service_id: "0199a3c0-0000-7000-8000-ffffffffffff",
      }),
    );
    expect(fk.status).toBe(ERR.ADMIN_INVALID_REQUEST.status);
  });

  it("scopes every read and write to the workspace", async () => {
    const a = core();
    const b = core();
    const s = await a.services.create({ name: "mine", host: "a.test" });
    expect((await b.services.list()).data).toEqual([]);
    expect((await rejection(b.services.get(String(s.id)))).status).toBe(404);
    expect(
      (await rejection(b.services.update(String(s.id), { host: "x" }))).status,
    ).toBe(404);
    expect((await rejection(b.services.delete(String(s.id)))).status).toBe(404);
    // Names are unique per workspace only.
    await b.services.create({ name: "mine", host: "b.test" });
    expect((await a.services.get(String(s.id))).host).toBe("a.test");
  });

  it("rejects references to another workspace's entities", async () => {
    const a = core();
    const b = core();
    const service = await a.services.create({ name: "a", host: "a.test" });
    const consumer = await a.consumers.create({ username: "alice" });
    const route = await a.routes.create({
      service_id: service.id,
      paths: ["/a"],
    });
    // Thunks: each call runs (and rejects) only when awaited.
    const attempts = [
      () => b.routes.create({ service_id: service.id, paths: ["/b"] }),
      () => b.plugins.create({ name: "cors", route_id: route.id }),
      () => b.acls.create({ consumer_id: consumer.id, group: "x" }),
      () => b.keyAuth.create({ consumer_id: String(consumer.id) }),
      () =>
        b.basicAuth.create({
          consumer_id: String(consumer.id),
          username: "u",
          password: "p",
        }),
    ];
    for (const attempt of attempts) {
      const res = await rejection(attempt());
      expect(res.status).toBe(ERR.ADMIN_INVALID_REQUEST.status);
      expect(res.body.constraint).toBe("foreign_key");
    }
    // Updates are checked too.
    const own = await b.services.create({ name: "b", host: "b.test" });
    const bRoute = await b.routes.create({ service_id: own.id, paths: ["/b"] });
    const moved = await rejection(
      b.routes.update(String(bRoute.id), { service_id: service.id }),
    );
    expect(moved.status).toBe(ERR.ADMIN_INVALID_REQUEST.status);
    // Nothing in workspace b refers to workspace a.
    expect((await b.compileSnapshot()).routes.map((r) => r.service_id)).toEqual(
      [own.id],
    );
  });

  it("filters only on visible, known columns", async () => {
    const admin = core();
    const unknown = await rejection(admin.services.lookup("x", "nope"));
    expect(unknown.status).toBe(ERR.ADMIN_INVALID_REQUEST.status);
    const wheres: Record<string, string>[] = [{ key_hash: "x" }, { nope: "x" }];
    for (const where of wheres) {
      const res = await rejection(admin.keyAuth.list({ where }));
      expect(res.status).toBe(ERR.ADMIN_INVALID_REQUEST.status);
    }
  });

  it("pages lists in id order and filters by tags", async () => {
    const admin = core();
    for (const [i, tags] of [["a"], ["a", "b"], ["b"], []].entries()) {
      await admin.consumers.create({ username: `u${i}`, tags });
    }
    const first = await admin.consumers.list({ size: 3 });
    expect(first.data.map((c) => c.username)).toEqual(["u0", "u1", "u2"]);
    const second = await admin.consumers.list({
      size: 3,
      offset: first.offset,
    });
    expect(second.data.map((c) => c.username)).toEqual(["u3"]);
    expect(second.offset).toBeUndefined();

    const names = async (values: string[], match: "and" | "or") =>
      (await admin.consumers.list({ tags: { values, match } })).data.map(
        (c) => c.username,
      );
    expect(await names(["a"], "and")).toEqual(["u0", "u1"]);
    expect(await names(["a", "b"], "and")).toEqual(["u1"]);
    expect(await names(["a", "b"], "or")).toEqual(["u0", "u1", "u2"]);
    // Tags are matched as whole elements, not as JSON text.
    await admin.consumers.create({ username: "q", tags: ['x","a'] });
    expect(await names(["a"], "and")).toEqual(["u0", "u1"]);
    expect(await names(['x","a'], "and")).toEqual(["q"]);
  });
});

describe("internal fields", () => {
  it("keeps the portal's subject out of reads, filters and writes", async () => {
    const admin = core();
    const dev = await admin.consumers.findOrCreateBy("portal_subject", "sub-1");
    expect(dev).not.toHaveProperty("portal_subject");
    // The same subject finds the same consumer.
    expect(
      (await admin.consumers.findOrCreateBy("portal_subject", "sub-1")).id,
    ).toBe(dev.id);
    // An entity write can't set it, so no one can claim another's subject.
    const other = await admin.consumers.create({
      username: "other",
      portal_subject: "sub-1",
    });
    expect(other).not.toHaveProperty("portal_subject");
    await expect(
      admin.consumers.list({ where: { portal_subject: "sub-1" } }),
    ).rejects.toThrow();
    // PATCH and PUT keep it.
    await admin.consumers.update(String(dev.id), {
      username: "renamed",
      portal_subject: "sub-2",
    });
    await admin.consumers.update(String(dev.id), { username: "again" }, true);
    expect(
      (await admin.consumers.findOrCreateBy("portal_subject", "sub-1")).id,
    ).toBe(dev.id);
    // Only internal fields can be found or created by.
    await expect(
      admin.consumers.findOrCreateBy("username", "x"),
    ).rejects.toThrow();
  });
});

describe("audit events", () => {
  it("records each change with its diff, actor and request id", async () => {
    const admin = core();
    const s = await admin.services.create({ name: "a", host: "a.test" });
    await admin.services.update(String(s.id), { host: "b.test" });
    await admin.services.delete(String(s.id));
    const events = await admin.audit.list();
    expect(events.map((e) => e.action)).toEqual(["delete", "update", "create"]);
    expect(events[1]).toMatchObject({
      actor: "drew@example.com",
      request_id: "req-1",
      entity_type: "services",
      entity_id: s.id,
    });
    expect(events[1]?.diff).toContainEqual(
      expect.objectContaining({
        type: "CHANGE",
        path: ["host"],
        value: "b.test",
      }),
    );
  });

  it("refuses a route path Kong wouldn't take, naming it", async () => {
    const admin = core();
    const error = await rejection(
      admin.routes.create({ name: "bad", paths: ["/ok", "no-slash"] }),
    );
    expect(error.status).toBe(400);
    expect(
      (error.body.issues as { path: string }[]).map((i) => i.path),
    ).toEqual(["paths.1"]);
    // "/" and Kong's "~" regex paths are fine; so is no path at all.
    await admin.routes.create({ name: "ok", paths: ["/a", "~/b/\\d+$"] });
    await admin.routes.create({ name: "hosts-only", hosts: ["a.test"] });
    const updated = await rejection(
      admin.routes.update(String((await admin.routes.lookup("ok")).id), {
        paths: ["oops"],
      }),
    );
    expect(updated.status).toBe(400);
    expect(
      (updated.body.issues as { path: string }[]).map((i) => i.path),
    ).toEqual(["paths.0"]);
  });

  it("refuses an uploaded plugin's limits outside the sandbox's", async () => {
    const admin = core();
    const code = "export default {}";
    const limits = {
      cpu_ms: SANDBOX.maxCpuMs,
      sub_requests: SANDBOX.maxSubRequests,
    };
    const paths = async (promise: Promise<unknown>) => {
      const error = await rejection(promise);
      expect(error.status).toBe(400);
      return (error.body.issues as { path: string }[]).map((i) => i.path);
    };
    // At the limit is fine.
    const ok = await admin.sandbox_plugins.create({
      name: "ok",
      code,
      ...limits,
    });
    const id = String(ok.id);
    for (const [field, max] of Object.entries(limits)) {
      for (const value of [max + 1, 0]) {
        expect(
          await paths(
            admin.sandbox_plugins.create({ name: "bad", code, [field]: value }),
          ),
        ).toEqual([field]);
        expect(
          await paths(admin.sandbox_plugins.update(id, { [field]: value })),
        ).toEqual([field]);
      }
    }
    expect(await admin.sandbox_plugins.update(id, { cpu_ms: 1 })).toMatchObject(
      { cpu_ms: 1, sub_requests: SANDBOX.maxSubRequests },
    );
  });

  it("names who staged each pending change", async () => {
    const workspaceId = workspace();
    const drew = core(workspaceId);
    const sam = core(workspaceId, "sam@example.com");
    const s = await drew.services.create({ name: "orders", host: "o.test" });
    const r = await sam.routes.create({
      name: "orders-route",
      paths: ["/orders"],
      service_id: s.id,
    });
    await sam.consumers.create({ username: "acme" });
    const changes = await drew.pendingChanges();
    const by = (id: unknown) =>
      changes.find((c) => c.path[1] === id && c.path.length === 2);
    expect(by(s.id)).toMatchObject({
      type: "CREATE",
      actor: "drew@example.com",
      entity: { name: "orders" },
    });
    expect(by(r.id)).toMatchObject({
      actor: "sam@example.com",
      entity: { name: "orders-route", paths: ["/orders"] },
    });
    // ACLs and group memberships are keyed by consumer and group, not id.
    const acme = changes.find(
      (c) => c.path[0] === "consumers" && c.path.length === 2,
    );
    const consumerId = String(acme?.path[1]);
    await sam.acls.create({ consumer_id: consumerId, group: "gold" });
    const group = await drew.consumer_groups.create({ name: "partners" });
    await sam.groupMembers.add(String(group.id), consumerId);
    const later = await drew.pendingChanges();
    expect(later.find((c) => c.path[0] === "acls")?.actor).toBe(
      "sam@example.com",
    );
    expect(
      later.find((c) => c.path[0] === "consumer_group_consumers")?.actor,
    ).toBe("sam@example.com");
    // An edited ACL: the new key and the removed old one are the editor's.
    const acl = (await drew.acls.list({ size: 10 })).data.find(
      (row) => row.group === "gold",
    );
    const published = await drew.compileSnapshot();
    await drew.acls.update(String(acl?.id), { group: "silver" });
    const edited = await drew.pendingChanges(published);
    const aclChange = (key: string) =>
      edited.find((c) => c.path[0] === "acls" && c.path[1] === key);
    expect(aclChange(`${consumerId}:silver`)).toMatchObject({
      type: "CREATE",
      actor: "drew@example.com",
    });
    expect(aclChange(`${consumerId}:gold`)).toMatchObject({
      type: "REMOVE",
      actor: "drew@example.com",
    });
    // A later edit by the other one makes it theirs.
    await sam.services.update(String(s.id), { host: "o2.test" });
    expect(
      (await drew.pendingChanges()).find((c) => c.path[1] === s.id)?.actor,
    ).toBe("sam@example.com");
  });

  it("pages and filters by actor, action and entity type", async () => {
    const workspaceId = workspace();
    const drew = core(workspaceId);
    const sam = core(workspaceId, "sam@example.com");
    const s = await drew.services.create({ name: "a", host: "a.test" });
    await sam.services.update(String(s.id), { host: "b.test" });
    await drew.consumers.create({ username: "c" });
    await sam.services.delete(String(s.id));
    const actions = (rows: { action: string }[]) => rows.map((e) => e.action);

    // Newest first.
    expect(actions((await drew.audit.page()).data)).toEqual([
      "delete",
      "create",
      "update",
      "create",
    ]);
    expect(
      (await drew.audit.page({ actor: "sam@example.com" })).data.map(
        (e) => e.actor,
      ),
    ).toEqual(["sam@example.com", "sam@example.com"]);
    expect(actions((await drew.audit.page({ action: "create" })).data)).toEqual(
      ["create", "create"],
    );
    expect(
      (await drew.audit.page({ entityType: "consumers" })).data.map(
        (e) => e.entity_type,
      ),
    ).toEqual(["consumers"]);

    // Pages of two: a cursor to the next, none on the last.
    const first = await drew.audit.page({ size: 2 });
    expect(actions(first.data)).toEqual(["delete", "create"]);
    expect(first.next).toBe(first.data[1]?.id);
    const second = await drew.audit.page({ size: 2, cursor: first.next });
    expect(actions(second.data)).toEqual(["update", "create"]);
    expect(second.next).toBeUndefined();
    // Filters and the cursor together.
    const sams = await drew.audit.page({ actor: "sam@example.com", size: 1 });
    expect(actions(sams.data)).toEqual(["delete"]);
    expect(
      actions(
        (await drew.audit.page({ actor: "sam@example.com", cursor: sams.next }))
          .data,
      ),
    ).toEqual(["update"]);
  });

  it("is written in the same batch: a failed change leaves no event", async () => {
    const admin = core();
    await admin.services.create({ name: "a", host: "a.test" });
    await rejection(admin.services.create({ name: "a", host: "b.test" }));
    expect(await admin.audit.list()).toHaveLength(1);
  });

  it("is written in the same batch: a failed event rolls back the change", async () => {
    const ws = workspace();
    // A null actor violates audit_events.actor NOT NULL.
    const broken = core(ws, null as unknown as string);
    await expect(
      broken.services.create({ name: "a", host: "a.test" }),
    ).rejects.toThrow();
    expect((await core(ws).services.list()).data).toEqual([]);
  });
});

describe("credentials", () => {
  it("key-auth: concurrent rolls leave exactly one key, all audited", async () => {
    const admin = core();
    const consumer = await admin.consumers.create({ username: "roller" });
    const consumer_id = String(consumer.id);
    for (let i = 0; i < 3; i++) await admin.keyAuth.create({ consumer_id });
    const rolled = await Promise.all(
      Array.from({ length: 6 }, () => admin.keyAuth.roll(consumer_id)),
    );
    const left = (await admin.keyAuth.list({ where: { consumer_id } })).data;
    expect(left).toHaveLength(1);
    expect(rolled.map((r) => r.credential.id)).toContain(left[0]?.id);
    // The raw key never reaches a stored row or the audit log.
    const audit = JSON.stringify(await admin.audit.list());
    for (const r of rolled) expect(audit).not.toContain(r.key);
    expect(audit).toContain("delete");
  });

  it("key-auth: a named key keeps its name through rename and rotate", async () => {
    const admin = core();
    const consumer = await admin.consumers.create({ username: "namer" });
    const consumer_id = String(consumer.id);
    const { credential, key } = await admin.keyAuth.create({
      consumer_id,
      name: "laptop",
    });
    expect(credential).toMatchObject({ name: "laptop" });
    const renamed = await admin.keyAuth.rename(String(credential.id), "server");
    expect(renamed).toMatchObject({ id: credential.id, name: "server" });
    const rotated = await admin.keyAuth.rotate(String(credential.id));
    expect(rotated.key).not.toBe(key);
    expect(rotated.credential).toMatchObject({
      id: credential.id,
      name: "server",
    });
    expect(rotated.credential.key_prefix).not.toBe(credential.key_prefix);
  });

  it("basic-auth: refuses a missing or empty password", async () => {
    const admin = core();
    const consumer = await admin.consumers.create({ username: "pw" });
    const consumer_id = String(consumer.id);
    for (const password of [undefined, ""]) {
      expect(
        await rejection(
          admin.basicAuth.create({
            consumer_id,
            username: "pw",
            password: password as string,
          }),
        ),
      ).toMatchObject({ status: ERR.ADMIN_INVALID_REQUEST.status });
    }
    const made = await admin.basicAuth.create({
      consumer_id,
      username: "pw",
      password: "s3cret",
    });
    expect(
      await rejection(
        admin.basicAuth.update(String(made.id), { password: "" }),
      ),
    ).toMatchObject({ status: ERR.ADMIN_INVALID_REQUEST.status });
  });

  it("key-auth: shows no prefix of a short user-supplied key", async () => {
    const admin = core();
    const consumer = await admin.consumers.create({ username: "short" });
    const consumer_id = String(consumer.id);
    const short = await admin.keyAuth.create({ consumer_id, key: "abc12345" });
    expect(short.credential.key_prefix).toBe("");
    const long = "k".repeat(API_KEY.minPrefixedLength);
    const kept = await admin.keyAuth.create({ consumer_id, key: long });
    expect(kept.credential.key_prefix).toBe(
      long.slice(0, API_KEY.displayPrefixLength),
    );
  });

  it("internal fields are set only through setInternal, and audited", async () => {
    const admin = core();
    const consumer = await admin.consumers.create({ username: "internal" });
    const id = String(consumer.id);
    expect(
      await rejection(admin.consumers.setInternal(id, { username: "x" })),
    ).toMatchObject({ status: ERR.ADMIN_INVALID_REQUEST.status });
    await admin.consumers.setInternal(id, { portal_blocked: true });
    expect(await admin.consumers.internalOf(id)).toMatchObject({
      portal_blocked: true,
    });
    // Entity writes can't touch it.
    await admin.consumers.update(id, { portal_blocked: false } as never);
    expect(await admin.consumers.internalOf(id)).toMatchObject({
      portal_blocked: true,
    });
    const events = await admin.audit.list();
    expect(JSON.stringify(events)).toContain("portal_blocked");
  });

  it("key-auth: a per-consumer limit holds under concurrent creates", async () => {
    const admin = core();
    const consumer = await admin.consumers.create({ username: "racer" });
    const other = await admin.consumers.create({ username: "other" });
    const consumerId = String(consumer.id);
    await admin.keyAuth.create({ consumer_id: String(other.id) });
    const max = 3;
    const settled = await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        admin.keyAuth.create(
          { consumer_id: consumerId },
          { maxPerConsumer: max },
        ),
      ),
    );
    const refused = settled.filter((r) => r.status === "rejected");
    expect(settled.filter((r) => r.status === "fulfilled")).toHaveLength(max);
    expect(refused).toHaveLength(8 - max);
    const first = refused[0] as PromiseRejectedResult;
    expect(await rejection(Promise.reject(first.reason))).toMatchObject({
      status: ERR.ADMIN_KEY_LIMIT.status,
      body: { code: ERR.ADMIN_KEY_LIMIT.code, limit: max },
    });
    // Only the kept keys are stored and audited; other consumers don't count.
    const keys = await admin.keyAuth.list({
      where: { consumer_id: consumerId },
    });
    expect(keys.data).toHaveLength(max);
    const created = (await admin.audit.list()).filter(
      (e) => e.entity_type === "keyauth_credentials" && e.action === "create",
    );
    expect(created).toHaveLength(max + 1);
    expect(
      (
        await admin.keyAuth.create(
          { consumer_id: String(other.id) },
          { maxPerConsumer: max },
        )
      ).credential.consumer_id,
    ).toBe(other.id);
  });

  it("key-auth: generates a key shown once, stores only its hash", async () => {
    const admin = core();
    const consumer = await admin.consumers.create({ username: "alice" });
    const { credential, key } = await admin.keyAuth.create({
      consumer_id: String(consumer.id),
    });
    expect(key.startsWith(API_KEY.prefix)).toBe(true);
    expect(credential).not.toHaveProperty("key_hash");
    expect(credential.key_prefix).toBe(
      key.slice(0, API_KEY.displayPrefixLength),
    );
    expect(JSON.stringify(credential)).not.toContain(key);
    expect(await admin.keyAuth.get(String(credential.id))).not.toHaveProperty(
      "key_hash",
    );
    const listed = await admin.keyAuth.list();
    expect(JSON.stringify(listed)).not.toContain(await sha256Hex(key));
    // The hash never reaches the audit log either.
    expect(JSON.stringify(await admin.audit.list())).not.toContain(
      await sha256Hex(key),
    );
    // Only the snapshot (for the data plane) carries the hash.
    const snapshot = await admin.compileSnapshot();
    expect(snapshot.keyauth_credentials?.[0]?.key_hash).toBe(
      await sha256Hex(key),
    );
  });

  it("key-auth: accepts a supplied key (decK) and rotates", async () => {
    const admin = core();
    const consumer = await admin.consumers.create({ username: "bob" });
    const { credential } = await admin.keyAuth.create({
      consumer_id: String(consumer.id),
      key: "given-key",
      ttl: 60,
    });
    const rotated = await admin.keyAuth.rotate(String(credential.id));
    expect(rotated.key).not.toBe("given-key");
    const [snap] = (await admin.compileSnapshot()).keyauth_credentials ?? [];
    expect(snap?.key_hash).toBe(await sha256Hex(rotated.key));
    expect(snap?.expires_at).toBe(Number(credential.created_at) + 60);
  });

  it("basic-auth: stores Kong's sha1(password .. consumer_id), never returns it", async () => {
    const admin = core();
    const consumer = await admin.consumers.create({ username: "carol" });
    const id = String(consumer.id);
    const credential = await admin.basicAuth.create({
      consumer_id: id,
      username: "carol",
      password: "s3cret",
    });
    expect(credential).not.toHaveProperty("password");
    expect(await basicAuthHash("s3cret", id)).toBe(
      await sha1Hex(`s3cret${id}`),
    );
    const stored = () =>
      admin.compileSnapshot().then((s) => s.basicauth_credentials?.[0]);
    expect((await stored())?.password).toBe(await basicAuthHash("s3cret", id));
    await admin.basicAuth.update(String(credential.id), {
      password: "new",
      // The owner can't change: the hash is bound to it.
      consumer_id: "someone-else",
    } as never);
    expect((await admin.basicAuth.get(String(credential.id))).consumer_id).toBe(
      id,
    );
    expect((await stored())?.password).toBe(await basicAuthHash("new", id));
    expect(JSON.stringify(await admin.audit.list())).not.toContain(
      await basicAuthHash("new", id),
    );
  });
});

describe("staging", () => {
  it("compiles the workspace into the data plane's snapshot", async () => {
    const admin = core();
    const service = await admin.services.create({
      name: "httpbin",
      host: "httpbin.org",
      protocol: "https",
      port: 443,
    });
    const off = await admin.services.create({
      name: "off",
      host: "off.test",
      enabled: false,
    });
    const route = await admin.routes.create({
      service_id: service.id,
      paths: ["/demo"],
    });
    const offRoute = await admin.routes.create({
      service_id: off.id,
      paths: ["/off"],
    });
    await admin.plugins.create({
      name: "rate-limiting",
      route_id: route.id,
      config: { minute: 5 },
    });
    const consumer = await admin.consumers.create({ username: "dave" });
    const group = await admin.consumer_groups.create({ name: "gold" });
    await admin.groupMembers.add(String(group.id), String(consumer.id));
    await admin.acls.create({ consumer_id: consumer.id, group: "admins" });

    const snapshot = await admin.compileSnapshot();
    expect(snapshot.services.map((s) => s.id)).toEqual([service.id]);
    expect(snapshot.services.map((s) => s.id)).not.toContain(off.id);
    // A disabled service's routes aren't loaded either (Kong).
    expect(snapshot.routes.map((r) => r.id)).not.toContain(offRoute.id);
    expect(snapshot.routes[0]).toMatchObject({
      id: route.id,
      service_id: service.id,
      paths: ["/demo"],
      strip_path: true,
      // Kong's default protocols, for the gateway's https-only check.
      protocols: ["http", "https"],
      // Kong's default: refuse plain HTTP on an https-only route.
      https_redirect_status_code: 426,
    });
    expect(snapshot.plugins[0]).toMatchObject({
      name: "rate-limiting",
      route_id: route.id,
      config: { minute: 5 },
    });
    expect(snapshot.acls).toEqual([
      { consumer_id: consumer.id, group: "admins" },
    ]);
    expect(snapshot.consumer_group_consumers).toEqual([
      { consumer_group_id: group.id, consumer_id: consumer.id },
    ]);
    await admin.groupMembers.remove(String(group.id), String(consumer.id));
    expect((await admin.compileSnapshot()).consumer_group_consumers).toEqual(
      [],
    );
  });

  it("carries service tags, Kong upstreams and their targets", async () => {
    const admin = core();
    await admin.services.create({
      name: "orders",
      host: "orders.internal",
      tags: ["edgway-binding:ORDERS"],
    });
    const upstream = await admin.upstreams.create({ name: "pool" });
    await admin.targets.create({
      upstream_id: upstream.id,
      target: "a.test:443",
      weight: 300,
    });
    const snapshot = await admin.compileSnapshot();
    expect(snapshot.services[0]?.tags).toEqual(["edgway-binding:ORDERS"]);
    expect(snapshot.upstreams).toEqual([
      expect.objectContaining({
        id: upstream.id,
        name: "pool",
        algorithm: "round-robin",
      }),
    ]);
    expect(snapshot.targets).toEqual([
      expect.objectContaining({
        upstream_id: upstream.id,
        target: "a.test:443",
        weight: 300,
      }),
    ]);
  });

  it("never shows credential hashes in the pending diff", async () => {
    const admin = core();
    const consumer = await admin.consumers.create({ username: "erin" });
    const cid = String(consumer.id);
    const { credential, key } = await admin.keyAuth.create({
      consumer_id: cid,
    });
    await admin.basicAuth.create({
      consumer_id: cid,
      username: "erin",
      password: "pw",
    });
    const secrets = async () => [
      await sha256Hex(key),
      await basicAuthHash("pw", cid),
    ];
    const created = JSON.stringify(await admin.pendingDiff());
    for (const secret of await secrets()) expect(created).not.toContain(secret);
    expect(created).toContain(ADMIN_DIFF.redacted);

    const published = await admin.compileSnapshot();
    const rotated = await admin.keyAuth.rotate(String(credential.id));
    const changed = await admin.pendingDiff(published);
    const text = JSON.stringify(changed);
    for (const secret of [...(await secrets()), await sha256Hex(rotated.key)]) {
      expect(text).not.toContain(secret);
    }
    // A rotation still shows as a change of the (masked) hash.
    expect(changed).toContainEqual(
      expect.objectContaining({
        type: "CHANGE",
        path: ["keyauth_credentials", String(credential.id), "key_hash"],
        value: ADMIN_DIFF.redactedChanged,
      }),
    );
    // The published snapshot itself is left intact for publishing.
    expect(published.keyauth_credentials?.[0]?.key_hash).toBe(
      await sha256Hex(key),
    );
  });

  it("reports the pending diff against the published snapshot", async () => {
    const admin = core();
    const a = await admin.services.create({ name: "a", host: "a.test" });
    const first = await admin.pendingDiff();
    expect(first).toContainEqual(
      expect.objectContaining({
        type: "CREATE",
        path: ["services", String(a.id)],
      }),
    );

    const published = await admin.compileSnapshot();
    expect(await admin.pendingDiff(published)).toEqual([]);

    // One new row changes only that row, whatever its position.
    await admin.services.create({ name: "0-first", host: "b.test" });
    await admin.services.update(String(a.id), { host: "c.test" });
    const next = await admin.pendingDiff(published);
    expect(next.map((d) => d.type).sort()).toEqual(["CHANGE", "CREATE"]);
    expect(snapshotDiff(published, published)).toEqual([]);
  });
});

describe("secrets", () => {
  it("stores jwt secrets as vault references only", async () => {
    const admin = core();
    const consumer = await admin.consumers.create({ username: "jwt-owner" });
    const raw = await rejection(
      admin.jwt_secrets.create({
        consumer_id: consumer.id,
        key: "iss-raw",
        secret: "plain-shared-secret",
      }),
    );
    expect(raw.status).toBe(ERR.ADMIN_INVALID_REQUEST.status);
    const created = await admin.jwt_secrets.create({
      consumer_id: consumer.id,
      key: "iss-ref",
      secret: "{vault://env/jwt-secret}",
    });
    expect(created.secret).toBe("{vault://env/jwt-secret}");
    // RS256 credentials carry a public key and no secret.
    await admin.jwt_secrets.create({
      consumer_id: consumer.id,
      key: "iss-rsa",
      algorithm: "RS256",
      rsa_public_key: "-----BEGIN PUBLIC KEY-----",
    });
  });

  it("stores certificate keys as vault references only", async () => {
    const admin = core();
    const raw = await rejection(
      admin.certificates.create({
        cert: "-----BEGIN CERTIFICATE-----",
        key: "-----BEGIN PRIVATE KEY-----",
      }),
    );
    expect(raw.status).toBe(ERR.ADMIN_INVALID_REQUEST.status);
    expect(raw.body).toMatchObject({ field: "key" });
    const rawAlt = await rejection(
      admin.certificates.create({
        cert: "-----BEGIN CERTIFICATE-----",
        key: "{vault://env/tls-key}",
        cert_alt: "-----BEGIN CERTIFICATE-----",
        key_alt: "-----BEGIN EC PRIVATE KEY-----",
      }),
    );
    expect(rawAlt.body).toMatchObject({ field: "key_alt" });
    const created = await admin.certificates.create({
      cert: "-----BEGIN CERTIFICATE-----",
      key: "{vault://env/tls-key}",
    });
    expect(created.key).toBe("{vault://env/tls-key}");
  });

  it("masks raw secrets in diffs and audit rows, keeping vault references", async () => {
    const admin = core();
    await admin.plugins.create({
      name: "openid-connect",
      config: {
        issuer: "https://idp.example/",
        client_secret: ["raw-client-secret"],
        session_secret: "{vault://env/session}",
      },
    });
    const pending = JSON.stringify(await admin.pendingDiff());
    expect(pending).not.toContain("raw-client-secret");
    expect(pending).toContain(ADMIN_DIFF.redacted);
    expect(pending).toContain("{vault://env/session}");
    const audit = JSON.stringify(await admin.audit.list());
    expect(audit).not.toContain("raw-client-secret");
    expect(audit).toContain("{vault://env/session}");
  });

  it("shows a changed raw secret as changed, never its value", async () => {
    const admin = core();
    const plugin = await admin.plugins.create({
      name: "ai-proxy",
      config: {
        route_type: "llm/v1/chat",
        model: { provider: "openai" },
        auth: { header_name: "Authorization", header_value: "Bearer one" },
      },
    });
    const published = await admin.compileSnapshot();
    await admin.plugins.update(String(plugin.id), {
      config: {
        route_type: "llm/v1/chat",
        model: { provider: "openai" },
        auth: { header_name: "Authorization", header_value: "Bearer two" },
      },
    });
    const changed = JSON.stringify(await admin.pendingDiff(published));
    expect(changed).toContain(ADMIN_DIFF.redactedChanged);
    expect(changed).not.toMatch(/Bearer (one|two)/);
    const [update] = await admin.audit.list();
    expect(JSON.stringify(update)).not.toMatch(/Bearer (one|two)/);
    expect(JSON.stringify(update)).toContain(ADMIN_DIFF.redactedChanged);
  });
});

describe("plugin secrets come from Kong's schemas", () => {
  /** A config holding a raw value at `path` (arrays get one item). */
  const configAt = (path: readonly string[], value: string): unknown => {
    const [head, ...rest] = path;
    if (head === undefined) return value;
    if (head === "[]") return [configAt(rest, value)];
    return { [head]: configAt(rest, value) };
  };

  it("masks every field each plugin's Kong schema marks encrypted", () => {
    let checked = 0;
    for (const name of PLUGIN_NAMES) {
      for (const path of pluginSecretPaths(name) ?? []) {
        const raw = `raw:${name}:${path.join(".")}`;
        const masked = redactRow("plugins", {
          name,
          config: configAt(path, raw),
        });
        expect(
          JSON.stringify(masked),
          `${name} ${path.join(".")}`,
        ).not.toContain(raw);
        checked += 1;
      }
    }
    // The schemas mark these (ai-proxy, openid-connect, http-log, redis).
    expect(checked).toBeGreaterThanOrEqual(25);
  });

  it("covers the fields a hand-kept list missed", () => {
    const paths = (name: string) =>
      (pluginSecretPaths(name) ?? []).map((p) => p.join("."));
    expect(paths("ai-proxy")).toEqual(
      expect.arrayContaining([
        "auth.aws_secret_access_key",
        "auth.azure_client_secret",
        "auth.gcp_service_account_json",
        "auth.header_value",
      ]),
    );
    expect(paths("openid-connect")).toEqual(
      expect.arrayContaining([
        "client_jwk.[].d",
        "introspection_headers_values",
        "redis.sentinel_password",
      ]),
    );
    expect(paths("http-log")).toEqual(["http_endpoint"]);
    // A field Kong doesn't mark stays visible.
    const shown = redactRow("plugins", {
      name: "http-log",
      config: { http_endpoint: "https://u:p@logs.example/", method: "POST" },
    });
    expect(shown.config).toEqual({
      http_endpoint: ADMIN_DIFF.redacted,
      method: "POST",
    });
  });

  it("falls back to field names for configs without a Kong schema", () => {
    const shown = redactRow("plugins", {
      name: "my-uploaded-plugin",
      config: { api_key: "raw", label: "kept" },
    });
    expect(shown.config).toEqual({
      api_key: ADMIN_DIFF.redacted,
      label: "kept",
    });
  });
});

describe("portal labels", () => {
  it("labels a developer with a display name, never a username", async () => {
    const admin = core();
    await admin.consumers.create({ username: "taken@example.com" });
    const { consumer } = await admin.portal.signIn("label-sub-1");
    const id = String(consumer.id);

    // The first usable candidate becomes the display name, even one an
    // admin's consumer holds as its username: it's a label, not a name.
    const labelled = await admin.portal.label(id, [
      undefined,
      "taken@example.com",
    ]);
    expect(labelled.display_name).toBe("taken@example.com");
    expect(labelled.username ?? null).toBeNull();
    // Already labelled: left as it is.
    expect(
      (await admin.portal.label(id, ["other@example.com"])).display_name,
    ).toBe("taken@example.com");

    // Nothing usable: no label, no error.
    const second = (await admin.portal.signIn("label-sub-2")).consumer;
    const none = await admin.portal.label(String(second.id), [undefined, ""]);
    expect(none.display_name ?? null).toBeNull();
    // The admin's consumer is untouched.
    expect(
      (await admin.consumers.list()).data.filter(
        (c) => c.username === "taken@example.com",
      ),
    ).toHaveLength(1);
  });
});

describe("portal developer cap", () => {
  it("refuses a new developer past the install's cap, never an existing one", async () => {
    const admin = createAdminCore(env.DB, {
      workspaceId: workspace(),
      actor: "portal",
      maxPortalDevelopers: 2,
    });
    // An admin's own consumers don't count.
    await admin.consumers.create({ username: "not-a-developer" });
    await admin.portal.signIn("dev-1");
    await admin.portal.signIn("dev-2");
    const third = await rejection(admin.portal.signIn("dev-3"));
    expect(third.status).toBe(ERR.PORTAL_DEVELOPER_LIMIT.status);
    expect(third.body).toMatchObject({
      code: ERR.PORTAL_DEVELOPER_LIMIT.code,
    });
    // Signing in again is fine, and no consumer was left behind.
    expect((await admin.portal.signIn("dev-1")).consumer.id).toBeDefined();
    expect((await admin.consumers.list()).data).toHaveLength(3);
  });
});
