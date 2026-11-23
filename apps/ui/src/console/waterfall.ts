/** The route tester's waterfall: pure offsets, no React. */
import { TRACE } from "@edgway/constants";

export const UPSTREAM = TRACE.upstream;

export interface Segment {
  label: string;
  phase: string;
  outcome?: string;
  start: number;
  duration: number;
}

/**
 * The waterfall: each entry starts where the one before it ended,
 * from the trace's own `durationMs`. The gateway records the upstream call
 * in the trace, in order, only when it made one; when a plugin
 * answered instead, there's no upstream bar.
 */
export function waterfall(
  trace: {
    plugin: string;
    phase: string;
    outcome: string;
    durationMs: number;
  }[],
): Segment[] {
  let start = 0;
  return trace.map((entry) => {
    const segment = {
      label: entry.plugin,
      phase: entry.phase,
      outcome: entry.outcome || undefined,
      start,
      duration: entry.durationMs,
    };
    start += entry.durationMs;
    return segment;
  });
}

/**
 * What the bars are scaled against: the whole request, so a short
 * trace in a longer request takes only its share of the track; the trace's
 * own end if that's later.
 */
export function spanOf(segments: Segment[], totalMs: number): number {
  return Math.max(
    totalMs,
    ...segments.map((s) => s.start + s.duration),
    Number.EPSILON,
  );
}
