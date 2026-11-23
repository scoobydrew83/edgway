/**
 * Exact rate-limit counters for Kong's `policy: cluster` and for hour, day,
 * month and year windows: a Durable Object per client key, fixed-window
 * counters in its (SQLite-backed) storage. Expired windows are deleted on
 * every write, so a key holds at most one entry per window size. Salvaged from the scaffold's
 * RateLimiter DO (apps/gateway/src/do/rate-limiter.ts), whose sliding window
 * kept one timestamp per hit.
 */

import { DurableObject } from "cloudflare:workers";
import type { RateLimitStore } from "@edgway/core";
import { type KongWindow, windowBounds } from "./windows.js";

export interface WindowCount {
  count: number;
  resetAt: number;
}

interface Stored {
  count: number;
  expires: number;
}

/**
 * Storage key for one window of one size: `<size>:<start>`. Stored through the
 * DO storage API, which a SQLite-backed Durable Object keeps in SQLite.
 */
const storageKey = (window: KongWindow, start: number) => `${window}:${start}`;

/** The token window containing `now` (ai-rate-limiting-advanced). */
function tokenWindow(windowSeconds: number, now: number) {
  const size = windowSeconds * 1000;
  const start = Math.floor(now / size) * size;
  return { key: `ai:${windowSeconds}:${start}`, end: start + size };
}

export class RateLimitCounter extends DurableObject {
  /** Delete every expired window; a key keeps at most one per window size. */
  private async sweep(now: number): Promise<void> {
    const stored = await this.ctx.storage.list<Stored>();
    const expired = [...stored]
      .filter(([, value]) => value.expires <= now)
      .map(([key]) => key);
    if (expired.length > 0) await this.ctx.storage.delete(expired);
  }

  async increment(window: KongWindow, now: number): Promise<WindowCount> {
    await this.sweep(now);
    const { start, end } = windowBounds(window, now);
    const key = storageKey(window, start);
    const count = ((await this.ctx.storage.get<Stored>(key))?.count ?? 0) + 1;
    await this.ctx.storage.put<Stored>(key, { count, expires: end });
    return { count, resetAt: end };
  }

  async decrement(window: KongWindow, now: number): Promise<void> {
    const { start } = windowBounds(window, now);
    const key = storageKey(window, start);
    const stored = await this.ctx.storage.get<Stored>(key);
    if (stored) {
      await this.ctx.storage.put<Stored>(key, {
        ...stored,
        count: Math.max(stored.count - 1, 0),
      });
    }
  }

  async get(window: KongWindow, now: number): Promise<WindowCount | undefined> {
    const { start, end } = windowBounds(window, now);
    const stored = await this.ctx.storage.get<Stored>(
      storageKey(window, start),
    );
    return stored ? { count: stored.count, resetAt: end } : undefined;
  }

  /** Reset one window size; the client's other windows keep counting. */
  async reset(window: KongWindow): Promise<void> {
    const keys = await this.ctx.storage.list({ prefix: `${window}:` });
    if (keys.size > 0) await this.ctx.storage.delete([...keys.keys()]);
  }

  /**
   * ai-rate-limiting-advanced's token counts: fixed windows of
   * `windowSeconds`, aligned to the epoch, under `ai:<seconds>:<start>`.
   */
  async addTokens(
    windowSeconds: number,
    tokens: number,
    now: number,
  ): Promise<void> {
    await this.sweep(now);
    const { key, end } = tokenWindow(windowSeconds, now);
    const count =
      ((await this.ctx.storage.get<Stored>(key))?.count ?? 0) + tokens;
    await this.ctx.storage.put<Stored>(key, { count, expires: end });
  }

  /** Tokens counted in the current window, and when it ends. */
  async tokens(windowSeconds: number, now: number): Promise<WindowCount> {
    const { key, end } = tokenWindow(windowSeconds, now);
    const stored = await this.ctx.storage.get<Stored>(key);
    return { count: stored?.count ?? 0, resetAt: end };
  }

  /** Stored windows (diagnostics: stays bounded). */
  async rows(): Promise<number> {
    return (await this.ctx.storage.list()).size;
  }
}

export interface DurableObjectStoreOptions {
  namespace: DurableObjectNamespace<RateLimitCounter>;
  window: KongWindow;
  /** Injectable clock (tests); the caller's clock keeps windows consistent. */
  now?: () => number;
}

/** A hono-rate-limiter Store over RateLimitCounter: one object per client key. */
export function createDurableObjectStore(
  options: DurableObjectStoreOptions,
): RateLimitStore {
  const now = options.now ?? Date.now;
  const counter = (key: string) =>
    options.namespace.get(options.namespace.idFromName(key));
  return {
    localKeys: false,
    async increment(key) {
      const { count, resetAt } = await counter(key).increment(
        options.window,
        now(),
      );
      return { totalHits: count, resetTime: new Date(resetAt) };
    },
    async get(key) {
      const current = await counter(key).get(options.window, now());
      return current
        ? { totalHits: current.count, resetTime: new Date(current.resetAt) }
        : undefined;
    },
    // Like hono-rate-limiter's MemoryStore, this undoes a hit in the window
    // current when it is called, which differs if the window has rolled over.
    async decrement(key) {
      await counter(key).decrement(options.window, now());
    },
    async resetKey(key) {
      await counter(key).reset(options.window);
    },
  };
}
