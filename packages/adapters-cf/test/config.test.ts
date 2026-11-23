import { env } from "cloudflare:test";
import { CONFIG, KV_KEY } from "@edgway/constants";
import { sha256Hex } from "@edgway/core";
import { CompactSign, generateKeyPair } from "jose";
import { beforeEach, describe, expect, it } from "vitest";
import {
  type ConfigVersion,
  createConfigStore,
  SnapshotUnavailable,
  type StoredSnapshot,
  versionReader,
} from "../src/index";

const admin = await generateKeyPair("EdDSA", { extractable: true });
const attacker = await generateKeyPair("EdDSA", { extractable: true });

/** What the admin does on publish: sign {version, sha256}, write KV. */
async function signed(
  version: number,
  config: unknown,
  key: CryptoKey = admin.privateKey,
): Promise<StoredSnapshot> {
  const snapshot = JSON.stringify(config);
  const manifest = await new CompactSign(
    new TextEncoder().encode(
      JSON.stringify({ version, sha256: await sha256Hex(snapshot) }),
    ),
  )
    .setProtectedHeader({ alg: "EdDSA" })
    .sign(key);
  return { manifest, snapshot };
}

async function publish(
  version: number,
  stored: StoredSnapshot,
  movePointer = true,
) {
  await env.CONFIG_KV.put(
    KV_KEY.configVersion(version),
    JSON.stringify(stored),
  );
  if (movePointer)
    await env.CONFIG_KV.put(KV_KEY.configCurrent, JSON.stringify({ version }));
}

const versionObject = () =>
  env.CONFIG_VERSION.get(
    env.CONFIG_VERSION.idFromName(CONFIG.versionObjectName),
  );

/** Counts KV reads, to prove the per-isolate cache. */
function countingKv() {
  let reads = 0;
  const kv = {
    get: (...args: Parameters<KVNamespace["get"]>) => {
      reads++;
      return (env.CONFIG_KV.get as (...a: unknown[]) => unknown)(...args);
    },
  } as unknown as KVNamespace;
  return { kv, reads: () => reads };
}

beforeEach(async () => {
  await env.CONFIG_KV.delete(KV_KEY.configCurrent);
  for (const v of [1, 2, 3])
    await env.CONFIG_KV.delete(KV_KEY.configVersion(v));
});

describe("ConfigStore", () => {
  it("loads config:current, then config:v{n}, verified", async () => {
    await publish(1, await signed(1, { routes: ["a"] }));
    const store = createConfigStore({
      kv: env.CONFIG_KV,
      publicKey: admin.publicKey,
    });
    expect(await store.current()).toEqual({
      version: 1,
      config: { routes: ["a"] },
    });
  });

  it("rejects a tampered snapshot", async () => {
    const stored = await signed(1, { routes: ["a"] });
    await publish(1, {
      ...stored,
      snapshot: JSON.stringify({ routes: ["evil"] }),
    });
    const rejected: string[] = [];
    const store = createConfigStore({
      kv: env.CONFIG_KV,
      publicKey: admin.publicKey,
      onReject: (_v, reason) => rejected.push(reason),
    });
    await expect(store.current()).rejects.toBeInstanceOf(SnapshotUnavailable);
    expect(rejected).toEqual(["digest"]);
  });

  it("rejects a manifest signed with another key", async () => {
    await publish(1, await signed(1, { routes: [] }, attacker.privateKey));
    const store = createConfigStore({
      kv: env.CONFIG_KV,
      publicKey: admin.publicKey,
    });
    await expect(store.current()).rejects.toMatchObject({
      reason: "signature",
    });
  });

  it("rejects a manifest for another version (replay)", async () => {
    await publish(2, await signed(1, { routes: [] }));
    const store = createConfigStore({
      kv: env.CONFIG_KV,
      publicKey: admin.publicKey,
    });
    await expect(store.current()).rejects.toMatchObject({ reason: "version" });
  });

  it("keeps serving the last verified snapshot when a new one is bad", async () => {
    await publish(1, await signed(1, { ok: true }));
    const store = createConfigStore({
      kv: env.CONFIG_KV,
      publicKey: admin.publicKey,
      versionCheckMs: 0,
    });
    await store.current();
    await publish(2, {
      ...(await signed(2, { ok: true })),
      snapshot: '{"ok":false}',
    });
    expect(await store.current()).toEqual({ version: 1, config: { ok: true } });
  });

  it("caches per isolate: no KV reads inside the check interval", async () => {
    await publish(1, await signed(1, { routes: [] }));
    const counting = countingKv();
    const store = createConfigStore({
      kv: counting.kv,
      publicKey: admin.publicKey,
    });
    await store.current();
    const after = counting.reads();
    for (let i = 0; i < 20; i++) await store.current();
    expect(counting.reads()).toBe(after);
  });

  it("picks up a version bump from the Durable Object without waiting for KV", async () => {
    await publish(1, await signed(1, { v: 1 }));
    // v2 is written, but KV's config:current pointer still says 1 (not yet propagated).
    await publish(2, await signed(2, { v: 2 }), false);
    const store = createConfigStore({
      kv: env.CONFIG_KV,
      publicKey: admin.publicKey,
      versions: versionReader(env.CONFIG_VERSION),
      versionCheckMs: 0,
    });
    await versionObject().set(1);
    expect((await store.current()).version).toBe(1);

    await versionObject().set(2); // the admin's publish
    expect(await store.current()).toEqual({ version: 2, config: { v: 2 } });

    await versionObject().set(1); // rollback moves the pointer back
    expect((await store.current()).version).toBe(1);
  });

  it("keeps serving the cache when the Durable Object or KV fails", async () => {
    await publish(1, await signed(1, { v: 1 }));
    let failKv = false;
    const kv = {
      get: (...args: Parameters<KVNamespace["get"]>) => {
        if (failKv) return Promise.reject(new Error("KV unavailable"));
        return (env.CONFIG_KV.get as (...a: unknown[]) => unknown)(...args);
      },
    } as unknown as KVNamespace;
    let failDo = true;
    const broken = {
      idFromName: () => ({}),
      get: () => ({
        current: () =>
          failDo
            ? Promise.reject(new Error("DO overloaded"))
            : Promise.resolve(1),
      }),
    } as unknown as DurableObjectNamespace<ConfigVersion>;
    const errors: unknown[] = [];
    const store = createConfigStore({
      kv,
      publicKey: admin.publicKey,
      versions: versionReader(broken),
      versionCheckMs: 0,
      onError: (error) => errors.push(error),
    });
    // The DO fails with nothing cached: no version (KV's unsigned pointer is
    // never read while the DO is bound).
    await expect(store.current()).rejects.toBeInstanceOf(SnapshotUnavailable);
    failDo = false;
    expect((await store.current()).version).toBe(1);
    // Now the DO and KV fail: the verified cache keeps serving.
    failDo = true;
    failKv = true;
    expect(await store.current()).toEqual({ version: 1, config: { v: 1 } });
    expect(errors.length).toBeGreaterThanOrEqual(2);
  });

  it("rejects a malformed value in KV without a cache", async () => {
    await env.CONFIG_KV.put(KV_KEY.configCurrent, "{not json");
    const store = createConfigStore({
      kv: env.CONFIG_KV,
      publicKey: admin.publicKey,
    });
    await expect(store.current()).rejects.toBeInstanceOf(SnapshotUnavailable);
  });

  it("keeps the old snapshot while a new version hasn't reached KV here", async () => {
    await publish(1, await signed(1, { v: 1 }));
    const store = createConfigStore({
      kv: env.CONFIG_KV,
      publicKey: admin.publicKey,
      versions: versionReader(env.CONFIG_VERSION),
      versionCheckMs: 0,
    });
    await versionObject().set(1);
    await store.current();
    await versionObject().set(3); // v3 not in KV yet
    expect((await store.current()).version).toBe(1);
  });
});

describe("ConfigVersion under concurrency", () => {
  // A fresh object per test: these don't touch the live version others use.
  const fresh = (name: string) =>
    env.CONFIG_VERSION.get(env.CONFIG_VERSION.idFromName(name));

  it("never hands out a number twice to concurrent allocates", async () => {
    const object = fresh("concurrent-allocate");
    const numbers = await Promise.all(
      Array.from({ length: 50 }, () => object.allocate(0)),
    );
    expect(new Set(numbers).size).toBe(50);
    expect(Math.max(...numbers)).toBe(50);
  });

  it("lets exactly one of concurrent compare-and-sets win", async () => {
    const object = fresh("concurrent-cas");
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        object.compareAndSet(undefined, i + 1),
      ),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
    const winner = results.indexOf(true) + 1;
    expect(await object.current()).toBe(winner);
  });
});
