import { describe, expect, it } from "vitest";
import { HEADER, KV_KEY } from "./index.js";

describe("@edgway/constants", () => {
  it("formats config snapshot KV keys", () => {
    expect(KV_KEY.configVersion(42)).toBe("config:v42");
    expect(KV_KEY.configCurrent).toBe("config:current");
  });

  it("uses lower-case header names with the x-edgway- prefix for Edgway headers", () => {
    for (const name of Object.values(HEADER)) {
      expect(name).toBe(name.toLowerCase());
    }
    // Wire format locked here; gateway tests import HEADER.
    expect(HEADER.route).toBe("x-edgway-route");
    expect(HEADER.cache).toBe("x-edgway-cache");
    expect(HEADER.cacheTtl).toBe("x-edgway-cache-ttl");
    expect(HEADER.requestId).toBe("x-edgway-request-id");
  });
});
