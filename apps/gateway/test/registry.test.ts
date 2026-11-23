/**
 * the gateway bundles exactly the plugins the root
 * edgway.config.json lists (the admin's registry is generated from the same
 * list; `pnpm drift` checks both are regenerated).
 */
import { describe, expect, it } from "vitest";
import config from "../../../edgway.config.json";
import * as registry from "../src/generated/plugins";

describe("the bundled plugin registry", () => {
  it("has one plugin per package in edgway.config.json", () => {
    const names = Object.values(registry).map((plugin) => plugin.name);
    expect(names).toHaveLength(config.plugins.length);
    expect(new Set(names).size).toBe(names.length);
  });
});
