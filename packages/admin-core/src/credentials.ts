/**
 * Credential services. key-auth keys are generated with nanoid (or supplied,
 * as decK does), stored as a SHA-256 hash plus a display prefix, and returned
 * raw only once, from create or rotate. basic-auth passwords are stored in
 * Kong's format, `sha1(password .. consumer_id)`, so decK imports verify.
 * Hashes are never returned or audited.
 */
import { API_KEY } from "@edgway/constants";
import { sha1Hex, sha256Hex } from "@edgway/core";
import { ERR, fail } from "@edgway/errors";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { nanoid } from "nanoid";
import type { AuditContext } from "./audit.js";
import { entityService, type ListOptions, type Row } from "./entities.js";

export interface KeyAuthInput {
  id?: string;
  consumer_id: string;
  /** The raw key; generated when absent. */
  key?: string;
  /** Seconds until the key expires (Kong's `ttl`). */
  ttl?: number | null;
  tags?: string[] | null;
  /** The developer portal's label for the key; not Kong's. */
  name?: string | null;
}

export interface BasicAuthInput {
  id?: string;
  consumer_id: string;
  username: string;
  password: string;
  tags?: string[] | null;
}

/** A new key, in Edgway's format. */
export const generateKey = () => API_KEY.prefix + nanoid(API_KEY.randomChars);

const keyFields = async (key: string) => ({
  key_hash: await sha256Hex(key),
  key_prefix:
    key.length >= API_KEY.minPrefixedLength
      ? key.slice(0, API_KEY.displayPrefixLength)
      : "",
});

export function keyAuthService(db: DrizzleD1Database, ctx: AuditContext) {
  const rows = entityService(db, ctx, "keyauth_credentials", ["key_hash"]);
  return {
    list: (options?: ListOptions) => rows.list(options),
    get: (id: string) => rows.get(id),
    delete: (id: string) => rows.delete(id),

    /**
     * Create a key; the raw key is in the result only this once. With
     * `maxPerConsumer`, a consumer holding that many keys gets
     * ADMIN_KEY_LIMIT, atomically (the developer portal).
     */
    async create(
      input: KeyAuthInput,
      options: { maxPerConsumer?: number } = {},
    ): Promise<{ credential: Row; key: string }> {
      const key = input.key ?? generateKey();
      if (!key) fail(ERR.ADMIN_INVALID_REQUEST, { detail: "key" });
      const { key: _raw, ...rest } = input;
      const credential = await rows.create(
        { ...rest, ...(await keyFields(key)) },
        {},
        options.maxPerConsumer === undefined
          ? undefined
          : {
              field: "consumer_id",
              max: options.maxPerConsumer,
              error: ERR.ADMIN_KEY_LIMIT,
            },
      );
      return { credential, key };
    },

    /**
     * Roll a consumer's keys: every key is replaced by one new key in one
     * transaction, so concurrent rolls leave one key. The raw key is
     * in the result only this once.
     */
    async roll(consumerId: string): Promise<{ credential: Row; key: string }> {
      const key = generateKey();
      const credential = await rows.replaceAll(
        "consumer_id",
        consumerId,
        await keyFields(key),
      );
      return { credential, key };
    },

    /** Rename a key (the developer portal's label). */
    rename: (id: string, name: string | null) => rows.update(id, { name }),

    /**
     * Replace the key; the old one stops working at the next publish. The
     * row, and so its name, stays: the portal's per-key roll.
     */
    async rotate(id: string, key = generateKey()) {
      const credential = await rows.update(id, await keyFields(key));
      return { credential, key };
    },
  };
}

/**
 * A basic-auth password must be a non-empty string on every write path: the
 * hash of a missing one would be a guessable credential (a decK dump
 * has no passwords, so syncing it must fail rather than store one).
 */
function requirePassword(password: unknown): asserts password is string {
  if (typeof password !== "string" || password.length === 0) {
    fail(ERR.ADMIN_INVALID_REQUEST, { detail: "password" });
  }
}

/** Kong's basic-auth password hash. */
export const basicAuthHash = (password: string, consumerId: string) =>
  sha1Hex(password + consumerId);

export function basicAuthService(db: DrizzleD1Database, ctx: AuditContext) {
  const rows = entityService(db, ctx, "basicauth_credentials", ["password"]);
  return {
    list: (options?: ListOptions) => rows.list(options),
    get: (id: string) => rows.get(id),
    delete: (id: string) => rows.delete(id),

    async create(input: BasicAuthInput): Promise<Row> {
      requirePassword(input.password);
      return rows.create({
        ...input,
        password: await basicAuthHash(input.password, input.consumer_id),
      });
    },

    /** Change the username or password (re-hashed for the owning consumer). */
    async update(
      id: string,
      patch: Partial<Omit<BasicAuthInput, "consumer_id">>,
    ): Promise<Row> {
      const current = await rows.get(id);
      // The owner never changes: the hash is bound to the consumer id.
      const {
        password,
        consumer_id: _owner,
        ...rest
      } = patch as BasicAuthInput;
      if (password !== undefined) requirePassword(password);
      return rows.update(id, {
        ...rest,
        ...(password === undefined
          ? {}
          : {
              password: await basicAuthHash(
                password,
                String(current.consumer_id),
              ),
            }),
      });
    },
  };
}
