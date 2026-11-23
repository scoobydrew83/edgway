/** The query names proxy-cache keeps out of cache keys (credentials). */
import { describe, expect, it } from "vitest";
import { credentialParams } from "../src/context";

const snapshot = (
  plugins: {
    name: string;
    enabled?: boolean;
    config: Record<string, unknown>;
  }[],
) => ({
  services: [],
  routes: [],
  consumers: [],
  plugins: plugins.map((p, i) => ({ id: `p${i}`, ...p })),
});

describe("credentialParams", () => {
  it("applies key-auth's default key_names (apikey)", () => {
    expect(
      credentialParams(snapshot([{ name: "key-auth", config: {} }])),
    ).toEqual(["apikey"]);
  });

  it("collects configured names and skips disabled and other plugins", () => {
    expect(
      credentialParams(
        snapshot([
          { name: "key-auth", config: { key_names: ["X-Api-Key"] } },
          { name: "key-auth", enabled: false, config: { key_names: ["off"] } },
          { name: "cors", config: {} },
        ]),
      ),
    ).toEqual(["X-Api-Key"]);
  });
});
