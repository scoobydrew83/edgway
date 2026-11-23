/**
 * Structured logging with LogTape: JSON lines to the console, which Workers
 * Logs / Logpush / Tail Workers collect. Configure once per isolate.
 */
import {
  configureSync,
  getConfig,
  getConsoleSink,
  getLogger as getLogTapeLogger,
  jsonLinesFormatter,
  type Logger,
  type LogLevel,
  type Sink,
} from "@logtape/logtape";

const ROOT = "edgway";

export interface LoggingOptions {
  /** Lowest level emitted (default "info"). */
  level?: LogLevel;
  /** Replace the JSON console sink (tests). */
  sink?: Sink;
}

/** Configure logging for this isolate. Safe to call more than once. */
export function configureLogging(options: LoggingOptions = {}): void {
  if (getConfig() && !options.sink) return;
  configureSync({
    reset: true,
    sinks: {
      out: options.sink ?? getConsoleSink({ formatter: jsonLinesFormatter }),
    },
    loggers: [
      {
        category: [ROOT],
        lowestLevel: options.level ?? "info",
        sinks: ["out"],
      },
      { category: ["logtape", "meta"], lowestLevel: "warning", sinks: ["out"] },
    ],
  });
}

/** A logger under the `edgway` category, e.g. getLogger("gateway"). */
export const getLogger = (...category: string[]): Logger =>
  getLogTapeLogger([ROOT, ...category]);
