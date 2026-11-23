/**
 * Derived from Kong/kong 3.9.0 (kong/tools/timestamp.lua), Apache-2.0,
 * Copyright Kong Inc.; ported to TypeScript and modified (third-party/kong).
 *
 * Kong's rate-limiting windows. Kong counts in fixed windows aligned to UTC
 * (kong/tools/timestamp `get_timestamps`): months and years are calendar ones.
 */
export type KongWindow =
  | "second"
  | "minute"
  | "hour"
  | "day"
  | "month"
  | "year";

const FIXED_MS: Partial<Record<KongWindow, number>> = {
  second: 1_000,
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
};

/** Start (inclusive) and end (exclusive) of the window containing `now`. */
export function windowBounds(
  window: KongWindow,
  now: number,
): { start: number; end: number } {
  const size = FIXED_MS[window];
  if (size !== undefined) {
    const start = Math.floor(now / size) * size;
    return { start, end: start + size };
  }
  const date = new Date(now);
  const year = date.getUTCFullYear();
  if (window === "month") {
    const month = date.getUTCMonth();
    return {
      start: Date.UTC(year, month, 1),
      end: Date.UTC(year, month + 1, 1),
    };
  }
  return { start: Date.UTC(year, 0, 1), end: Date.UTC(year + 1, 0, 1) };
}
