/**
 * The ConfigVersion Durable Object: the live config version, strongly
 * consistent. The admin sets it on publish or rollback; gateways read it, so a
 * bump reaches every isolate within one check interval instead of waiting for
 * KV to propagate (60 s or more). It is the source of truth for the live
 * version: publishes take numbers from `allocate` (never reused) and
 * move it with `compareAndSet`, as rollbacks do, so concurrent publishers
 * can't both win, and a KV write alone can't move it.
 */
import { DurableObject } from "cloudflare:workers";

const VERSION_KEY = "version";
/** The highest version ever handed out: numbers are never reused. */
const ISSUED_KEY = "issued";

export class ConfigVersion extends DurableObject {
  async current(): Promise<number | undefined> {
    return this.ctx.storage.get<number>(VERSION_KEY);
  }

  async set(version: number): Promise<void> {
    await this.ctx.storage.put(VERSION_KEY, version);
  }

  /**
   * Hand out the next version number, above every number handed out before
   * and above `floor` (the highest the admin has recorded). It doesn't make
   * the number live: the publisher writes `config:v{n}` first, then moves the
   * live version with `compareAndSet`. A number is never reused, even after a
   * rollback, so no publish overwrites another's `config:v{n}`.
   */
  async allocate(floor = 0): Promise<number> {
    return this.exclusive(async () => {
      const issued = (await this.ctx.storage.get<number>(ISSUED_KEY)) ?? 0;
      const live = (await this.ctx.storage.get<number>(VERSION_KEY)) ?? 0;
      const next = Math.max(issued, live, floor) + 1;
      await this.ctx.storage.put(ISSUED_KEY, next);
      return next;
    });
  }

  /**
   * Move the version from `expected` to `next`; false (and no change) when
   * another publish moved it first. The read and the write run exclusively,
   * so they can't interleave with another call's.
   */
  async compareAndSet(
    expected: number | undefined,
    next: number | undefined,
  ): Promise<boolean> {
    return this.exclusive(async () => {
      const current = await this.ctx.storage.get<number>(VERSION_KEY);
      if (current !== expected) return false;
      // Undefined gives a claimed number back (no live version yet).
      if (next === undefined) await this.ctx.storage.delete(VERSION_KEY);
      else await this.ctx.storage.put(VERSION_KEY, next);
      return true;
    });
  }

  /**
   * A read-then-write no other call can interleave with. Input gates
   * alone didn't hold: under load, two concurrent `allocate`s both read the
   * same `issued` and handed out one number twice, so one publisher's
   * `config:v{n}` overwrote the other's.
   */
  private exclusive<T>(run: () => Promise<T>): Promise<T> {
    return this.ctx.blockConcurrencyWhile(run);
  }
}
