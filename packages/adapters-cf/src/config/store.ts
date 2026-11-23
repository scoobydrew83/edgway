/**
 * The ConfigStore adapter: the published snapshot from KV, verified against
 * its signed manifest `{version, sha256}` (jose, EdDSA; the gateway holds only
 * the public key) and cached per isolate. The live version comes from the
 * ConfigVersion Durable Object when bound (only), else from KV's
 * `config:current`.
 */
import { CONFIG, KV_KEY } from "@edgway/constants";
import { type ConfigSnapshot, type ConfigStore, sha256Hex } from "@edgway/core";
import { type CryptoKey, compactVerify, type JWK, type KeyObject } from "jose";
import type { ConfigVersion } from "./version-object.js";

/** Stored at `config:v{n}`: the signed manifest and the snapshot it covers. */
export interface StoredSnapshot {
  manifest: string;
  snapshot: string;
}

/** Why a snapshot was not used. */
export type RejectReason = "missing" | "signature" | "version" | "digest";

/** Thrown when there is no verified snapshot to serve. */
export class SnapshotUnavailable extends Error {
  constructor(readonly reason: RejectReason) {
    super(reason);
  }
}

/**
 * Where the live version is read: anything with `current()`. The gateway's
 * is the admin's read-only `ConfigVersionReader` over a Service Binding
 *; with the ConfigVersion namespace itself, use `versionReader`.
 */
export interface VersionReader {
  current(): Promise<number | undefined>;
}

/** A reader of the live version from the ConfigVersion namespace. */
export const versionReader = (
  namespace: DurableObjectNamespace<ConfigVersion>,
): VersionReader => ({
  current: () =>
    namespace.get(namespace.idFromName(CONFIG.versionObjectName)).current(),
});

export interface ConfigStoreOptions {
  kv: KVNamespace;
  publicKey: CryptoKey | KeyObject | JWK | Uint8Array;
  /** The live version's source, when bound. */
  versions?: VersionReader;
  /** Defaults to CONFIG.versionCheckMs. */
  versionCheckMs?: number;
  /** Told about every rejected snapshot (telemetry). */
  onReject?: (version: number, reason: RejectReason) => void;
  /** Told when refreshing fails (DO, KV or bad JSON); the cache keeps serving. */
  onError?: (error: unknown) => void;
}

/** Verify a stored snapshot for `version`; the reason when it fails. */
export async function verifySnapshot<T>(
  stored: StoredSnapshot,
  version: number,
  publicKey: ConfigStoreOptions["publicKey"],
): Promise<ConfigSnapshot<T> | RejectReason> {
  let manifest: { version?: unknown; sha256?: unknown };
  try {
    const { payload } = await compactVerify(stored.manifest, publicKey, {
      algorithms: ["EdDSA"],
    });
    manifest = JSON.parse(new TextDecoder().decode(payload));
  } catch {
    return "signature";
  }
  if (typeof manifest !== "object" || manifest === null) return "signature";
  if (manifest.version !== version) return "version";
  if (manifest.sha256 !== (await sha256Hex(stored.snapshot))) return "digest";
  return { version, config: JSON.parse(stored.snapshot) as T };
}

export function createConfigStore<T = unknown>(
  options: ConfigStoreOptions,
): ConfigStore<T> {
  const checkEvery = options.versionCheckMs ?? CONFIG.versionCheckMs;
  let cached: ConfigSnapshot<T> | undefined;
  let checkedAt = Number.NEGATIVE_INFINITY;

  /**
   * The live version. With the ConfigVersion DO bound, it is the only
   * source: KV's unsigned pointer is never read, so a KV write can't
   * roll the gateway back. If the DO can't be reached, a warm isolate keeps
   * its version and a cold one has none (503). Without the DO, KV's pointer.
   */
  async function liveVersion(): Promise<number | undefined> {
    if (options.versions) {
      try {
        return await options.versions.current();
      } catch (error) {
        options.onError?.(error);
        return cached?.version;
      }
    }
    const pointer = await options.kv.get<{ version: number }>(
      KV_KEY.configCurrent,
      "json",
    );
    return pointer?.version;
  }

  async function load(
    version: number,
  ): Promise<ConfigSnapshot<T> | RejectReason> {
    const stored = await options.kv.get<StoredSnapshot>(
      KV_KEY.configVersion(version),
      "json",
    );
    // A new key may not have reached this location yet.
    if (!stored) return "missing";
    return verifySnapshot<T>(stored, version, options.publicKey);
  }

  return {
    async current() {
      if (cached && Date.now() - checkedAt < checkEvery) return cached;
      checkedAt = Date.now();

      let version: number | undefined;
      let next: ConfigSnapshot<T> | RejectReason | undefined;
      try {
        version = await liveVersion();
        if (version !== undefined && version !== cached?.version) {
          next = await load(version);
        }
      } catch (error) {
        // KV unreachable or a malformed value: never fail over a good cache.
        options.onError?.(error);
        if (cached) return cached;
        throw new SnapshotUnavailable("missing");
      }
      if (version === undefined || next === undefined) {
        if (cached) return cached;
        throw new SnapshotUnavailable("missing");
      }
      if (typeof next === "string") {
        options.onReject?.(version, next);
        // Keep serving the last verified snapshot; never an unverified one.
        if (cached) return cached;
        throw new SnapshotUnavailable(next);
      }
      cached = next;
      return cached;
    },
  };
}
