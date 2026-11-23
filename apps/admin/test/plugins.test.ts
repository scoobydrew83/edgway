/**
 * the admin accepts the plugins the gateway bundles (the root
 * edgway.config.json), each validated against its own schema.
 */
import { describe, expect, it } from "vitest";
import config from "../../../edgway.config.json";
import { PLUGINS, pluginJsonSchema } from "../src/plugins";

describe("the admin's plugin catalog", () => {
  it("has one plugin per package in edgway.config.json", () => {
    expect(PLUGINS.size).toBe(config.plugins.length);
    expect(PLUGINS.get("key-auth")?.kong).toBe(true);
  });

  it("serves a JSON Schema only for a bundled plugin", () => {
    expect(pluginJsonSchema("key-auth")).toHaveProperty("properties.config");
    expect(pluginJsonSchema("not-bundled")).toBeUndefined();
  });
});
