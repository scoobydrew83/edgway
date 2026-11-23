/**
 * Error boundary for one plugin: a cockatiel timeout inside a circuit breaker,
 * one policy per plugin instance per isolate.
 */
import { PLUGIN_RUNNER } from "@edgway/constants";
import type { IPolicy } from "cockatiel";
import type { OnError, PluginInstance, PluginOutcome } from "./types.js";

/**
 * A deliberate response thrown by middleware (Hono's HTTPException, an
 * @edgway/errors problem): not a plugin failure.
 */
export function isDeliberate(
  error: unknown,
): error is { getResponse(): Response } {
  return (
    typeof error === "object" &&
    error !== null &&
    typeof (error as { getResponse?: unknown }).getResponse === "function"
  );
}

/**
 * cockatiel, loaded on first use: its module creates an `AbortController`
 * when it loads, which workerd forbids in global scope (a statically imported
 * cockatiel stops the bundled gateway from starting).
 */
let cockatiel: Promise<typeof import("cockatiel")> | undefined;
const loadCockatiel = () => {
  cockatiel ??= import("cockatiel");
  return cockatiel;
};

const policies = new Map<string, IPolicy>();

async function policyFor(plugin: PluginInstance): Promise<IPolicy> {
  const {
    ConsecutiveBreaker,
    circuitBreaker,
    handleWhen,
    TaskCancelledError,
    TimeoutStrategy,
    timeout,
    wrap,
  } = await loadCockatiel();
  const timeoutMs = plugin.timeoutMs ?? PLUGIN_RUNNER.timeoutMs;
  // Keyed by id and timeout, so a config change to the timeout takes effect.
  const key = `${plugin.id}:${timeoutMs}`;
  let policy = policies.get(key);
  if (!policy) {
    policy = wrap(
      // Only the plugin's own failures open its breaker: a timeout can be a
      // client's doing (a slowly sent body), and the breaker is shared by
      // every request on the isolate. A timeout still fails its own
      // request per on_error.
      circuitBreaker(
        handleWhen(
          (error) =>
            !isDeliberate(error) && !(error instanceof TaskCancelledError),
        ),
        {
          halfOpenAfter: PLUGIN_RUNNER.breakerHalfOpenMs,
          breaker: new ConsecutiveBreaker(PLUGIN_RUNNER.breakerFailures),
        },
      ),
      timeout(timeoutMs, TimeoutStrategy.Aggressive),
    );
    policies.set(key, policy);
  }
  return policy;
}

export type Guarded<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      outcome: Exclude<PluginOutcome, "ok" | "short-circuit">;
      error: unknown;
    };

/** Run a plugin's own work under its policy. Deliberate responses are rethrown. */
export async function guarded<T>(
  plugin: PluginInstance,
  work: () => Promise<T>,
): Promise<Guarded<T>> {
  const { BrokenCircuitError, TaskCancelledError } = await loadCockatiel();
  const policy = await policyFor(plugin);
  try {
    // A fresh signal per call: cockatiel's default is one module-level
    // signal, and Workers forbids sharing I/O objects between requests.
    const signal = new AbortController().signal;
    return { ok: true, value: await policy.execute(work, signal) };
  } catch (error) {
    if (isDeliberate(error)) throw error;
    const outcome =
      error instanceof TaskCancelledError
        ? "timeout"
        : error instanceof BrokenCircuitError
          ? "circuit-open"
          : "error";
    return { ok: false, outcome, error };
  }
}

export function onErrorOf(plugin: PluginInstance): OnError {
  return plugin.on_error ?? (plugin.enforces ? "fail-closed" : "fail-open");
}
