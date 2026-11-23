import { env } from "cloudflare:test";
import { HEADER } from "@edgway/constants";
import type { RateLimitStore } from "@edgway/core";
import { ERR } from "@edgway/errors";
import { Hono } from "hono";
import { rateLimiter } from "hono-rate-limiter";
import { describe, expect, it } from "vitest";
import {
  createBindingStore,
  createDurableObjectStore,
  type KongWindow,
  windowBounds,
} from "../src/index";

const at = (iso: string) => Date.parse(iso);
let keys = 0;
const uniqueKey = () => `client-${++keys}-${Math.random()}`;

describe("Kong windows (UTC, fixed)", () => {
  it.each<[KongWindow, string, string, string]>([
    [
      "second",
      "2026-09-29T10:15:30.700Z",
      "2026-09-29T10:15:30.000Z",
      "2026-09-29T10:15:31.000Z",
    ],
    [
      "minute",
      "2026-09-29T10:15:30.700Z",
      "2026-09-29T10:15:00.000Z",
      "2026-09-29T10:16:00.000Z",
    ],
    [
      "hour",
      "2026-09-29T10:15:30.700Z",
      "2026-09-29T10:00:00.000Z",
      "2026-09-29T11:00:00.000Z",
    ],
    [
      "day",
      "2026-09-29T10:15:30.700Z",
      "2026-09-29T00:00:00.000Z",
      "2026-09-30T00:00:00.000Z",
    ],
    [
      "month",
      "2026-09-29T10:15:30.700Z",
      "2026-09-01T00:00:00.000Z",
      "2026-10-01T00:00:00.000Z",
    ],
    [
      "month",
      "2026-12-31T23:59:59.999Z",
      "2026-12-01T00:00:00.000Z",
      "2027-01-01T00:00:00.000Z",
    ],
    [
      "year",
      "2026-09-29T10:15:30.700Z",
      "2026-01-01T00:00:00.000Z",
      "2027-01-01T00:00:00.000Z",
    ],
  ])("%s at %s", (window, now, start, end) => {
    expect(windowBounds(window, at(now))).toEqual({
      start: at(start),
      end: at(end),
    });
  });
});

describe("Durable Object counter store (policy: cluster)", () => {
  function store(window: KongWindow, clock: { now: number }) {
    return createDurableObjectStore({
      namespace: env.RATE_LIMIT_COUNTER,
      window,
      now: () => clock.now,
    });
  }

  it("counts hits in the current window and resets at its end", async () => {
    const clock = { now: at("2026-09-29T10:15:10Z") };
    const hours = store("hour", clock);
    const key = uniqueKey();
    expect((await hours.increment(key)).totalHits).toBe(1);
    const second = await hours.increment(key);
    expect(second.totalHits).toBe(2);
    expect(second.resetTime).toEqual(new Date(at("2026-09-29T11:00:00Z")));
    clock.now = at("2026-09-29T11:00:00Z");
    expect((await hours.increment(key)).totalHits).toBe(1);
  });

  it("keeps keys apart and windows apart", async () => {
    const clock = { now: at("2026-09-29T10:15:10Z") };
    const a = uniqueKey();
    const b = uniqueKey();
    await store("day", clock).increment(a);
    await store("day", clock).increment(a);
    expect((await store("day", clock).increment(b)).totalHits).toBe(1);
    expect((await store("month", clock).increment(a)).totalHits).toBe(1);
  });

  it("supports get, decrement and resetKey", async () => {
    const clock = { now: at("2026-09-29T10:15:10Z") };
    const days = store("day", clock);
    const key = uniqueKey();
    expect(await days.get?.(key)).toBeUndefined();
    await days.increment(key);
    await days.increment(key);
    await days.decrement(key);
    expect((await days.get?.(key))?.totalHits).toBe(1);
    await days.resetKey(key);
    expect(await days.get?.(key)).toBeUndefined();
  });

  it("resets only its own window for a client", async () => {
    const clock = { now: at("2026-09-29T10:15:10Z") };
    const key = uniqueKey();
    await store("minute", clock).increment(key);
    await store("hour", clock).increment(key);
    await store("hour", clock).increment(key);
    await store("minute", clock).resetKey(key);
    expect(await store("minute", clock).get?.(key)).toBeUndefined();
    expect((await store("hour", clock).get?.(key))?.totalHits).toBe(2);
  });

  it("holds at most one row per window size (bounded memory)", async () => {
    const clock = { now: at("2026-09-29T10:00:00Z") };
    const key = uniqueKey();
    const seconds = store("second", clock);
    for (let i = 0; i < 50; i++) {
      await seconds.increment(key);
      clock.now += 1_000;
    }
    const counter = env.RATE_LIMIT_COUNTER.get(
      env.RATE_LIMIT_COUNTER.idFromName(key),
    );
    expect(await counter.rows()).toBe(1);
  });

  it("enforces a limit through hono-rate-limiter", async () => {
    const clock = { now: at("2026-09-29T10:15:10Z") };
    const res = await limited(store("minute", clock), 2, uniqueKey());
    expect(res).toEqual([200, 200, ERR.RATE_LIMITED.status]);
  });
});

describe("Rate Limiting binding store (policy: local)", () => {
  it("denies once the binding's limit is used up", async () => {
    // The test binding allows 3 per 60 s (vitest.config.ts).
    const store = createBindingStore(env.RATE_LIMIT);
    expect(store.exact).toBe(false);
    const res = await limited(store, 3, uniqueKey(), 4);
    expect(res).toEqual([200, 200, 200, ERR.RATE_LIMITED.status]);
  });
});

/** Send `count` requests for one client through hono-rate-limiter; their statuses. */
async function limited(
  store: RateLimitStore,
  limit: number,
  client: string,
  count = limit + 1,
): Promise<number[]> {
  const app = new Hono();
  app.use(
    rateLimiter({
      windowMs: 60_000,
      limit,
      store,
      keyGenerator: (c) => c.req.header(HEADER.clientIp) ?? "",
    }),
  );
  app.get("/", (c) => c.text("ok"));
  const statuses: number[] = [];
  for (let i = 0; i < count; i++) {
    const res = await app.fetch(
      new Request("https://gw.example/", {
        headers: { [HEADER.clientIp]: client },
      }),
    );
    statuses.push(res.status);
  }
  return statuses;
}
