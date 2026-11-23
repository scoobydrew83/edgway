/** the route tester's waterfall offsets (a unit test, no browser). */
import { expect, test } from "@playwright/test";
import { spanOf, UPSTREAM, waterfall } from "../src/console/waterfall";

const entry = (plugin: string, phase: string, durationMs: number) => ({
  plugin,
  phase,
  outcome: "ok",
  durationMs,
});
/** The gateway's own upstream entry. */
const upstream = (durationMs: number) => ({
  plugin: UPSTREAM,
  phase: UPSTREAM,
  outcome: "",
  durationMs,
});

test("each entry starts where the one before ended, the upstream with its own time", () => {
  const segments = waterfall([
    entry("key-auth", "access", 2),
    entry("rate-limiting", "access", 3),
    upstream(14),
    entry("cors", "header_filter", 1),
  ]);
  expect(
    segments.map(({ label, start, duration }) => [label, start, duration]),
  ).toEqual([
    ["key-auth", 0, 2],
    ["rate-limiting", 2, 3],
    [UPSTREAM, 5, 14],
    ["cors", 19, 1],
  ]);
  expect(segments[2]?.outcome).toBeUndefined();
});

test("a plugin that answered: no upstream bar", () => {
  expect(
    waterfall([
      entry("request-termination", "access", 1),
      entry("cors", "header_filter", 1),
    ]).map((s) => [s.label, s.start, s.duration]),
  ).toEqual([
    ["request-termination", 0, 1],
    ["cors", 1, 1],
  ]);
});

test("bars are scaled against the whole request", () => {
  // A 5 ms plugin in a 44 ms request takes about 11% of the track.
  const segments = waterfall([entry("key-auth", "access", 5)]);
  expect(spanOf(segments, 44)).toBe(44);
  // A trace longer than the measured total is never cut off.
  expect(spanOf(waterfall([entry("cors", "header_filter", 50)]), 44)).toBe(50);
});
