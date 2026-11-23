/**
 * The key API's last refusal, as the developer should read it.
 * Zudoku shows only a generic error when the key list fails, so the
 * portal's own panel above the keys reads this instead.
 */
import { useSyncExternalStore } from "react";

let current: string | undefined;
const listeners = new Set<() => void>();
/** Defined once, so React doesn't resubscribe on every render. */
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export function setRefusal(message: string | undefined) {
  if (message === current) return;
  current = message;
  for (const listener of listeners) listener();
}

export function useRefusal(): string | undefined {
  return useSyncExternalStore(
    subscribe,
    () => current,
    // Prerendered pages have no refusal yet.
    () => undefined,
  );
}
