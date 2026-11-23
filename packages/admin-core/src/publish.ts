/**
 * Publish and rollback. Publishing compiles the staged snapshot, validates
 * every plugin against its Kong schema, diffs it with the published one,
 * signs the manifest `{version, sha256}` (jose CompactSign, EdDSA), writes
 * `config:v{n}`, and moves the live version. Rollback moves it back to an
 * earlier version. Both are audited.
 *
 * The ConfigVersion Durable Object is the live version's source of truth
 *. A publish takes a fresh number from it, writes `config:v{n}`,
 * and then moves the live version with compare-and-set, only while it is
 * still the one the publish built on: two publishers (the admin and the
 * portal) can't both win, and the loser rebuilds from the new live version.
 * The DO hands out each number once, so no publish overwrites another's
 * `config:v{n}`, even after a rollback. KV's `config:current` follows it for
 * readers without the DO.
 */
import type {
  ConfigVersion,
  Snapshot,
  StoredSnapshot,
} from "@edgway/adapters-cf";
import { verifySnapshot } from "@edgway/adapters-cf/config";
import {
  CONFIG,
  KV_KEY,
  MS_PER_SECOND,
  PORTAL,
  PUBLISH_WARNING,
  UPSTREAM,
} from "@edgway/constants";
import { compileRouter, sha256Hex } from "@edgway/core";
import { ERR, fail } from "@edgway/errors";
import { tables } from "@edgway/schema";
import { and, asc, desc, eq, inArray, lt, ne } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { CompactSign, importJWK, type JWK } from "jose";
import { uuidv7 } from "uuidv7";
import { auditInsert } from "./audit.js";
import {
  type CoreContext,
  catalogOf,
  checkPluginConfig,
  kongCatalog,
  type PluginCatalog,
} from "./catalog.js";
import { misplacedVaultReferences, rawSecretFields } from "./secrets.js";
import { compileSnapshot, EMPTY_SNAPSHOT, snapshotDiff } from "./snapshot.js";

/** Where snapshots are published, and the key that signs them. */
export interface PublishTarget {
  kv: KVNamespace;
  /** The Ed25519 private key (the admin's secret). */
  signingKey: CryptoKey;
  /**
   * The Ed25519 public half: the live snapshot is verified before anything
   * is built on it (the portal's credential publish).
   */
  publicKey?: CryptoKey;
  /** The ConfigVersion Durable Object namespace, when bound. */
  versions?: DurableObjectNamespace<ConfigVersion>;
}

const signingKeyCache = new Map<
  string,
  Promise<{ signingKey: CryptoKey; publicKey: CryptoKey }>
>();

/**
 * The signing key from the `CONFIG_SIGNING_KEY` secret (an Ed25519 private
 * JWK) and its public half, which verifies the live snapshot before anything
 * is built on it. Cached per isolate.
 */
export function importSigningKeys(secret: string) {
  let keys = signingKeyCache.get(secret);
  if (!keys) {
    const jwk = JSON.parse(secret) as JWK;
    // The public half: no private part, and no private key's key_ops/use.
    const { d: _private, key_ops: _ops, use: _use, ...publicJwk } = jwk;
    keys = Promise.all([
      importJWK(jwk, "EdDSA") as Promise<CryptoKey>,
      importJWK(publicJwk, "EdDSA") as Promise<CryptoKey>,
    ]).then(([signingKey, publicKey]) => ({ signingKey, publicKey }));
    signingKeyCache.set(secret, keys);
  }
  return keys;
}

/**
 * Every enabled plugin must be one the gateway bundles (`plugins`) or
 * a staged uploaded plugin, with a config its schema accepts; 400 with the
 * issues.
 */
export function validatePlugins(
  snapshot: Snapshot,
  plugins: PluginCatalog = kongCatalog(),
): void {
  const uploaded = new Set((snapshot.sandbox_plugins ?? []).map((p) => p.name));
  for (const plugin of snapshot.plugins) {
    // A vault reference only where Kong allows one: the gateway
    // resolves what it's given, so publish keeps references out of other
    // fields (a response body, a log header).
    const misplaced = misplacedVaultReferences(plugin.name, plugin.config);
    if (misplaced.length > 0) {
      fail(ERR.ADMIN_INVALID_REQUEST, {
        extensions: {
          plugin: plugin.id,
          name: plugin.name,
          vault_references: misplaced,
        },
      });
    }
    // An uploaded plugin has no Kong schema: its config is an object.
    if (uploaded.has(plugin.name)) {
      if (
        plugin.config === null ||
        typeof plugin.config !== "object" ||
        Array.isArray(plugin.config)
      ) {
        fail(ERR.ADMIN_INVALID_REQUEST, {
          extensions: { plugin: plugin.id, name: plugin.name },
        });
      }
      continue;
    }
    // The gateway runs only the plugins it bundles, each
    // validated against its own schema; a disabled instance of
    // another may stay staged.
    const bundled = plugins.get(plugin.name);
    if (!bundled) {
      if (plugin.enabled === false) continue;
      fail(ERR.ADMIN_INVALID_REQUEST, {
        extensions: { plugin: plugin.id, name: plugin.name, bundled: false },
      });
    }
    checkPluginConfig(bundled, plugin.config, { plugin: plugin.id });
  }
}

/** Something a publish goes ahead with, but says. */
export type PublishWarning =
  | {
      code: typeof PUBLISH_WARNING.upstreamAlgorithm;
      upstream: string;
      name?: string;
      algorithm: string;
      runs_as: string;
    }
  | {
      code: typeof PUBLISH_WARNING.rawSecret;
      plugin: string;
      name: string;
      fields: string[];
    };

/**
 * What a config publishes with but should know:
 * - upstreams whose algorithm the gateway runs as round-robin
 *   (`least-connections`, `latency`), never silently;
 * - plugins holding a secret as plain text in a field Kong lets hold a
 *   vault reference, so the secret lives in D1.
 */
export function publishWarnings(snapshot: Snapshot): PublishWarning[] {
  const warnings: PublishWarning[] = [];
  for (const upstream of snapshot.upstreams ?? []) {
    const { algorithm } = upstream;
    if (algorithm && !UPSTREAM.algorithms.includes(algorithm)) {
      warnings.push({
        code: PUBLISH_WARNING.upstreamAlgorithm,
        upstream: upstream.id,
        name: upstream.name,
        algorithm,
        runs_as: UPSTREAM.fallbackAlgorithm,
      });
    }
  }
  for (const plugin of snapshot.plugins) {
    const fields = rawSecretFields(plugin.name, plugin.config);
    if (fields.length > 0) {
      warnings.push({
        code: PUBLISH_WARNING.rawSecret,
        plugin: plugin.id,
        name: plugin.name,
        fields,
      });
    }
  }
  return warnings;
}

/**
 * Every route must be one the gateway's router can compile: a route with
 * `sources`, `destinations`, `snis`, `expression` or a regex JavaScript can't
 * run would be left out, and its traffic would fall to a broader route
 *. 400 naming each route and why.
 */
function validateRoutes(snapshot: Snapshot): void {
  const { skipped } = compileRouter(snapshot.routes, snapshot.services);
  if (skipped.length > 0) {
    fail(ERR.ADMIN_INVALID_REQUEST, {
      extensions: { unsupported_routes: skipped },
    });
  }
}

/** The published version the pointer names, if any. */
export async function currentVersion(kv: KVNamespace) {
  return (await kv.get<{ version: number }>(KV_KEY.configCurrent, "json"))
    ?.version;
}

/** The snapshot published as `version` (unverified: the admin's own KV). */
export async function publishedSnapshot(
  kv: KVNamespace,
  version: number | undefined,
): Promise<Snapshot | undefined> {
  if (version === undefined) return undefined;
  const stored = await kv.get<StoredSnapshot>(
    KV_KEY.configVersion(version),
    "json",
  );
  return stored ? (JSON.parse(stored.snapshot) as Snapshot) : undefined;
}

/** The snapshot collections that hold a consumer's credentials. */
const CREDENTIALS = [
  "keyauth_credentials",
  "basicauth_credentials",
  "jwt_secrets",
  "acls",
] as const;
type CredentialCollection = (typeof CREDENTIALS)[number];
type CredentialRow = { id?: unknown; consumer_id?: unknown };

const rowsOf = (
  snapshot: Snapshot,
  name: CredentialCollection,
): CredentialRow[] =>
  ((snapshot as unknown as Record<string, CredentialRow[] | undefined>)[name] ??
    []) as CredentialRow[];

/** A credential a rollback would make live again. */
export interface RevivedCredential {
  entity: CredentialCollection;
  id: string;
  consumer_id: string;
}

/**
 * The credentials in `target` that `live` doesn't have as they are: deleted
 * or rotated since. A snapshot's credential rows hold only what
 * authenticates (ids, hashes, secrets, groups), so any difference counts.
 */
export function revivedCredentials(
  target: Snapshot | undefined,
  live: Snapshot | undefined,
): RevivedCredential[] {
  if (!target) return [];
  return CREDENTIALS.flatMap((entity) => {
    const kept = new Set(
      (live ? rowsOf(live, entity) : []).map((row) => JSON.stringify(row)),
    );
    return rowsOf(target, entity)
      .filter((row) => !kept.has(JSON.stringify(row)))
      .map((row) => ({
        entity,
        // ACL rows have no id: the consumer and group name them.
        id: String(
          row.id ?? `${row.consumer_id}:${(row as { group?: unknown }).group}`,
        ),
        consumer_id: String(row.consumer_id),
      }));
  });
}

/** Where the live version is kept: KV, and the ConfigVersion DO when bound. */
export type VersionSource = Pick<PublishTarget, "kv" | "versions">;

const versionObject = (source: VersionSource) =>
  source.versions?.get(source.versions.idFromName(CONFIG.versionObjectName));

/**
 * The live version. With the ConfigVersion DO bound it is the only source:
 * KV's unsigned pointer is never read then, as the gateway does
 *. Without the DO, KV's pointer.
 */
export async function liveVersion(
  source: VersionSource,
): Promise<number | undefined> {
  const object = versionObject(source);
  return object ? object.current() : currentVersion(source.kv);
}

/**
 * The live snapshot. With `publicKey`, it must verify: a snapshot planted in
 * KV without the signing key is never built on. With `required`, a
 * live version whose snapshot this colo's KV doesn't have yet (KV is
 * eventually consistent) is a 503, never an empty config to build on.
 */
async function liveSnapshot(
  target: PublishTarget,
  version: number | undefined,
  required = false,
): Promise<Snapshot | undefined> {
  if (version === undefined) return undefined;
  const stored = await target.kv.get<StoredSnapshot>(
    KV_KEY.configVersion(version),
    "json",
  );
  if (!stored) {
    if (required) {
      fail(ERR.CONFIG_UNAVAILABLE, { extensions: { version } });
    }
    return undefined;
  }
  if (!target.publicKey) return JSON.parse(stored.snapshot) as Snapshot;
  const verified = await verifySnapshot<Snapshot>(
    stored,
    version,
    target.publicKey,
  );
  if (typeof verified === "string") {
    fail(ERR.ADMIN_PUBLISHED_INVALID, {
      extensions: { version, reason: verified },
    });
  }
  return verified.config;
}

/**
 * The next version number: from the DO, which hands each out once;
 * without it, the next after `floor`. Not live until `claim`.
 */
async function allocate(target: PublishTarget, floor: number): Promise<number> {
  const object = versionObject(target);
  return object ? object.allocate(floor) : floor + 1;
}

/** Move the live version from `reserved` to `version`; false when another publish moved it first. */
async function claim(
  target: PublishTarget,
  reserved: number | undefined,
  version: number | undefined,
): Promise<boolean> {
  const object = versionObject(target);
  return object ? object.compareAndSet(reserved, version) : true;
}

/**
 * Point KV's `config:current` at the live version (readers without the DO).
 * With the DO, the pointer follows the DO and is checked after each write:
 * publishes that finish out of order never leave it on an older version
 * (KV has no compare-and-set, so the last writer re-checks).
 */
async function pointKv(target: PublishTarget, version: number) {
  const object = versionObject(target);
  let next: number | undefined = version;
  for (let i = 0; i < CONFIG.publishAttempts && next !== undefined; i++) {
    await target.kv.put(
      KV_KEY.configCurrent,
      JSON.stringify({ version: next }),
    );
    if (!object) return;
    const live = await object.current();
    next = live === next ? undefined : live;
  }
}

export function publisher(db: DrizzleD1Database, ctx: CoreContext) {
  const versions = tables.config_versions;
  const scoped = eq(versions.workspace_id, ctx.workspaceId);

  /**
   * Builds the next snapshot from the live one, signs it under a fresh
   * version number, and makes it live only if the live version is still the
   * one it built on. Otherwise it starts again: reads the new live version
   * and rebuilds (`build` recompiles the staged rows each attempt), so a
   * concurrent publish's change is never dropped.
   *
   * Order: allocate → write `config:v{n}` → claim (compare-and-set) → D1
   * version row and audit → pointer. A gateway that sees the new version
   * finds its snapshot already written. A lost claim leaves only an unused
   * `config:v{n}`; a failed D1 write gives the live version back, so a version
   * is never left live without its row and audit event.
   */
  async function write(
    target: PublishTarget,
    build: (published: Snapshot | undefined) => Promise<Snapshot>,
    options: { note?: string; verify?: boolean } = {},
  ) {
    // A lost claim costs an attempt, unless a portal batch won it: those
    // publish at most once per PORTAL.publishBatchMs, so the admin's
    // publish tries again rather than failing.
    let lost = 0;
    let portalWins = 0;
    while (
      lost < CONFIG.publishAttempts &&
      portalWins <= CONFIG.portalConflictRetries
    ) {
      // The DO's raw value is also the compare-and-set's expected value.
      const current = await liveVersion(target);
      const [latest] = await db
        .select({ version: versions.version })
        .from(versions)
        .where(scoped)
        .orderBy(desc(versions.version))
        .limit(1);
      // No live version although one was published: the DO is new (an
      // upgrade from before an earlier release). Building on nothing would publish an
      // empty config, so the portal waits for the admin's next publish.
      if (options.verify && current === undefined && latest) {
        fail(ERR.CONFIG_UNAVAILABLE);
      }
      // A publish that builds on the live snapshot needs it, verified (a 503
      // while this location's KV hasn't received it: never an empty config);
      // a full publish only diffs against it.
      const published = options.verify
        ? await liveSnapshot(target, current, true)
        : await liveSnapshot({ ...target, publicKey: undefined }, current);
      const snapshot = await build(published);
      const diff = snapshotDiff(published, snapshot);
      const version = await allocate(
        target,
        Math.max(latest?.version ?? 0, current ?? 0),
      );

      const body = JSON.stringify(snapshot);
      const sha256 = await sha256Hex(body);
      const manifest = await new CompactSign(
        new TextEncoder().encode(JSON.stringify({ version, sha256 })),
      )
        .setProtectedHeader({ alg: "EdDSA" })
        .sign(target.signingKey);
      const stored: StoredSnapshot = { manifest, snapshot: body };
      await target.kv.put(
        KV_KEY.configVersion(version),
        JSON.stringify(stored),
      );

      if (!(await claim(target, current, version))) {
        if (await wonByPortal(target)) portalWins++;
        else lost++;
        continue;
      }
      try {
        await db.batch([
          db.insert(versions).values({
            id: uuidv7(),
            workspace_id: ctx.workspaceId,
            version,
            sha256,
            diff,
            created_by: ctx.actor,
            note: options.note,
          }),
          auditInsert(
            db,
            ctx,
            "publish",
            "config",
            String(version),
            {},
            { version, sha256 },
          ),
        ]);
      } catch (error) {
        // Not recorded: the live version goes back to what it was. If
        // another publish already moved it, say so rather than hide it.
        if (!(await claim(target, version, current))) {
          fail(ERR.ADMIN_PUBLISH_CONFLICT, {
            extensions: { version, recorded: false },
          });
        }
        throw error;
      }
      await pointKv(target, version);
      await prune(target, version);
      return { version, sha256, diff };
    }
    fail(ERR.ADMIN_PUBLISH_CONFLICT);
  }

  /** Whether the live version is a portal batch's (its row says so). */
  async function wonByPortal(target: PublishTarget): Promise<boolean> {
    const live = await liveVersion(target);
    if (live === undefined) return false;
    const [row] = await db
      .select({ created_by: versions.created_by })
      .from(versions)
      .where(and(scoped, eq(versions.version, live)))
      .limit(1);
    return row?.created_by === PORTAL.actor;
  }

  /**
   * Retention: the newest CONFIG.retainVersions versions, the
   * live one, and every version from the last CONFIG.retainSeconds are
   * kept; the rest lose their `config:v{n}` snapshot and row, at most
   * CONFIG.pruneBatch per publish. A failure here never fails the publish
   * that triggered it; the next one tries again.
   */
  async function prune(target: PublishTarget, live: number) {
    try {
      // The oldest of the newest retainVersions: anything older may go.
      const [floor] = await db
        .select({ version: versions.version })
        .from(versions)
        .where(scoped)
        .orderBy(desc(versions.version))
        .limit(1)
        .offset(CONFIG.retainVersions - 1);
      if (!floor) return;
      // created_at is in Unix seconds.
      const since =
        Math.floor(Date.now() / MS_PER_SECOND) - CONFIG.retainSeconds;
      const old = await db
        .select({ version: versions.version })
        .from(versions)
        .where(
          and(
            scoped,
            lt(versions.version, floor.version),
            lt(versions.created_at, since),
            ne(versions.version, live),
          ),
        )
        .orderBy(asc(versions.version))
        .limit(CONFIG.pruneBatch);
      // The live version now (a rollback may have moved it since) is kept
      // too.
      const now = await liveVersion(target);
      const numbers = old
        .map((row) => row.version)
        .filter((version) => version !== now);
      if (numbers.length === 0) return;
      // Read before deleting: a rollback may claim one of these between the
      // live check above and its delete (see below).
      const stored = await Promise.all(
        numbers.map((n) => target.kv.get(KV_KEY.configVersion(n))),
      );
      // Snapshots first, rows after: a row stays until its snapshot is gone,
      // so a failed KV delete is retried by the next prune, never orphaned.
      const deleted = await Promise.allSettled(
        numbers.map((n) => target.kv.delete(KV_KEY.configVersion(n))),
      );
      let gone = numbers.filter((_, i) => deleted[i]?.status === "fulfilled");
      // A rollback that went live on one of them meanwhile keeps it: its
      // snapshot goes back, and its row stays. The rollback checks again
      // after its claim, so whichever runs last puts the snapshot back.
      const after = await liveVersion(target);
      if (after !== undefined && gone.includes(after)) {
        const value = stored[numbers.indexOf(after)];
        if (value) await target.kv.put(KV_KEY.configVersion(after), value);
        gone = gone.filter((n) => n !== after);
      }
      if (gone.length === 0) return;
      await db
        .delete(versions)
        .where(and(scoped, inArray(versions.version, gone)));
    } catch {
      // Retention is housekeeping: the next publish prunes again.
    }
  }

  /**
   * A credential-only publish (the developer portal): the published
   * snapshot with just these consumers and their key-auth credentials
   * replaced by their staged rows. Nothing else staged goes live. The
   * portal's batch publishes every queued consumer at once.
   */
  async function publishConsumers(
    target: PublishTarget,
    consumerIds: readonly string[],
    note?: string,
  ) {
    const ids = new Set(consumerIds);
    const mine = (row: { id?: unknown; consumer_id?: unknown }) =>
      ids.has(String(row.id)) || ids.has(String(row.consumer_id));
    const ownCredential = (row: { consumer_id?: unknown }) =>
      ids.has(String(row.consumer_id));
    // Built on the live snapshot, which must verify.
    return write(
      target,
      async (live) => {
        const staged = await compileSnapshot(db, ctx);
        // Empty only before the first publish: a live version whose
        // snapshot can't be read is a 503 (liveSnapshot).
        const published = live ?? EMPTY_SNAPSHOT;
        return {
          ...published,
          consumers: [
            ...published.consumers.filter((c) => !mine(c)),
            ...staged.consumers.filter(mine),
          ],
          keyauth_credentials: [
            ...(published.keyauth_credentials ?? []).filter(
              (k) => !ownCredential(k),
            ),
            ...(staged.keyauth_credentials ?? []).filter(ownCredential),
          ],
        };
      },
      { note, verify: true },
    );
  }

  /**
   * An admin's revocation, live at once: a consumer deleted or
   * blocked, or a key-auth, basic-auth or jwt credential of theirs deleted
   * or rotated. It only takes away from the live snapshot:
   * - their live credentials whose id staged no longer has are dropped,
   *   all of them (ACLs included) when the consumer itself is gone;
   * - a rotated key's new hash replaces its old one (same id);
   * - nothing else staged goes live, and no other live row changes. ACL
   *   rows stay while the consumer does: dropping a group can grant access
   *   under an acl `deny` list, which is a publisher's call.
   */
  async function publishRevocations(
    target: PublishTarget,
    consumerIds: readonly string[],
    note?: string,
  ) {
    const ids = new Set(consumerIds);
    return write(
      target,
      async (live) => {
        const staged = await compileSnapshot(db, ctx);
        const published = live ?? EMPTY_SNAPSHOT;
        const stagedIds = new Set(staged.consumers.map((c) => String(c.id)));
        const gone = (row: CredentialRow) =>
          ids.has(String(row.consumer_id)) &&
          !stagedIds.has(String(row.consumer_id));
        const revoked: Partial<Record<CredentialCollection, CredentialRow[]>> =
          {};
        for (const name of CREDENTIALS) {
          const current = new Map(
            rowsOf(staged, name).map((row) => [String(row.id), row] as const),
          );
          revoked[name] = rowsOf(published, name).flatMap((row) => {
            if (gone(row)) return [];
            if (!ids.has(String(row.consumer_id)) || name === "acls") {
              return [row];
            }
            const now = current.get(String(row.id));
            if (!now || String(now.consumer_id) !== String(row.consumer_id)) {
              return [];
            }
            return [name === "keyauth_credentials" ? now : row];
          });
        }
        return {
          ...published,
          consumers: published.consumers.filter(
            (c) => !ids.has(String(c.id)) || stagedIds.has(String(c.id)),
          ),
          ...(revoked as unknown as Partial<Snapshot>),
        };
      },
      { note, verify: true },
    );
  }

  return {
    /** Published versions, newest first. */
    list: () =>
      db.select().from(versions).where(scoped).orderBy(desc(versions.version)),

    /** The newest published version, or undefined before the first. */
    latest: async () =>
      (
        await db
          .select()
          .from(versions)
          .where(scoped)
          .orderBy(desc(versions.version))
          .limit(1)
      )[0],

    async publish(target: PublishTarget, note?: string) {
      // Compiled per attempt: a retry includes what the winner staged.
      let warnings: PublishWarning[] = [];
      const result = await write(
        target,
        async () => {
          const staged = await compileSnapshot(db, ctx);
          validatePlugins(staged, catalogOf(ctx));
          validateRoutes(staged);
          warnings = publishWarnings(staged);
          return staged;
        },
        { note },
      );
      return { ...result, warnings };
    },

    publishConsumers,
    publishRevocations,

    /** One consumer's credentials (see publishConsumers). */
    async publishConsumer(
      target: PublishTarget,
      consumerId: string,
      note?: string,
    ) {
      return publishConsumers(target, [consumerId], note);
    },

    /**
     * Point the live config back at `version`. With `dryRun`, nothing moves:
     * the answer only says what would, including the credentials that would
     * work again, so a rollback can be confirmed knowing it.
     */
    async rollback(
      target: PublishTarget,
      version: number,
      options: { dryRun?: boolean } = {},
    ) {
      const [row] = await db
        .select({ version: versions.version })
        .from(versions)
        .where(and(scoped, eq(versions.version, version)))
        .limit(1);
      // A version older than the oldest kept was published, then pruned
      //: say so, and how far back rollback reaches.
      if (!row) {
        const [oldest] = await db
          .select({ version: versions.version })
          .from(versions)
          .where(scoped)
          .orderBy(asc(versions.version))
          .limit(1);
        if (oldest && version < oldest.version) {
          fail(ERR.ADMIN_VERSION_PRUNED, {
            extensions: { version, oldest: oldest.version },
          });
        }
      }
      const stored = row
        ? await target.kv.get(KV_KEY.configVersion(version))
        : null;
      if (!row || stored === null) {
        fail(ERR.ADMIN_NOT_FOUND, {
          extensions: { entity: "config", version },
        });
      }
      const from = await liveVersion(target);
      // Credentials the target has and the live config doesn't: revoked
      // (or rotated) since, and live again after this.
      const revived = revivedCredentials(
        await publishedSnapshot(target.kv, version),
        await publishedSnapshot(target.kv, from),
      );
      if (options.dryRun) return { version, from, revived };
      if (!(await claim(target, from, version))) {
        fail(ERR.ADMIN_PUBLISH_CONFLICT);
      }
      // A prune that read the live version before this claim may have
      // deleted the snapshot since: put back the bytes checked above (prune
      // checks again after its deletes, so one of the two always does).
      if ((await target.kv.get(KV_KEY.configVersion(version))) === null) {
        await target.kv.put(KV_KEY.configVersion(version), stored);
      }
      await pointKv(target, version);
      await auditInsert(
        db,
        ctx,
        "rollback",
        "config",
        String(version),
        { version: from },
        { version, revived },
      );
      return { version, from, revived };
    },
  };
}
