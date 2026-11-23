/**
 * Workers forbid random values in global scope (a deployed Worker fails to
 * start), so importing the plugin must not generate any.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.restoreAllMocks());

describe("module load", () => {
  it("generates no random values at import", async () => {
    vi.resetModules();
    const random = vi.spyOn(crypto, "getRandomValues");
    const uuid = vi.spyOn(crypto, "randomUUID");
    const plugin = (await import("../src/index")).default;
    expect(plugin.name).toBe("correlation-id");
    expect(random).not.toHaveBeenCalled();
    expect(uuid).not.toHaveBeenCalled();
  }, 30_000); // A fresh module graph is slow to load under a busy gate.
});
