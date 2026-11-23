/**
 * Workers forbid creating I/O objects such as AbortController in global
 * scope (a deployed Worker fails to start), so importing core must not, even
 * though cockatiel does when it loads: it is loaded on first use instead.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.restoreAllMocks());

describe("module load", () => {
  it("creates no AbortController at import", async () => {
    vi.resetModules();
    const created = vi.spyOn(globalThis, "AbortController");
    const core = await import("../src/index");
    expect(typeof core.buildGateway).toBe("function");
    expect(created).not.toHaveBeenCalled();
  }, 30_000); // A fresh module graph is slow to load under a busy gate.
});
