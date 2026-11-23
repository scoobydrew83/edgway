/**
 * Workers custom spans (PRD "Telemetry"): native Workers tracing,
 * exported over OTLP when the Worker's `observability.traces` names a
 * destination. Spans nest by async context under the platform's own (fetch,
 * KV, Durable Object calls). Without a tracer (tests, tracing off) the work
 * runs as it is.
 */
import type { Context } from "hono";

/** Span attributes; `undefined` values are left out. */
export type SpanAttributes = Readonly<
  Record<string, string | number | undefined>
>;

/** The request's tracer, when the runtime gives one. */
function tracerOf(c: Context): Tracing | undefined {
  try {
    return (c.executionCtx as ExecutionContext).tracing;
  } catch {
    // No execution context (e.g. app.request in tests).
    return undefined;
  }
}

/** Runs `work` in a span named `name`; the span ends when it settles. */
export function traced<T>(
  c: Context,
  name: string,
  attributes: SpanAttributes,
  work: () => Promise<T>,
): Promise<T> {
  const tracer = tracerOf(c);
  if (typeof tracer?.enterSpan !== "function") return work();
  return tracer.enterSpan(name, (span) => {
    for (const [key, value] of Object.entries(attributes)) {
      if (value !== undefined) span.setAttribute(key, value);
    }
    return work();
  });
}
