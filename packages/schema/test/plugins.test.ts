import { readFileSync } from "node:fs";
import { Validator } from "@cfworker/json-schema";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  isPluginName,
  jsonSchema,
  kongSchema,
  PLUGIN_NAMES,
  type PluginName,
} from "../src/index";

const vendored = (name: string) =>
  JSON.parse(
    readFileSync(
      new URL(
        `../../../vendor/kong-schemas/3.9/plugins/${name}.json`,
        import.meta.url,
      ),
      "utf8",
    ),
  );

// PRD v1 plugin list (Kong names; the PRD's ai-rate-limiting is Kong's ai-rate-limiting-advanced).
const V1_PLUGINS = [
  "acl",
  "ai-prompt-guard",
  "ai-proxy",
  "ai-rate-limiting-advanced",
  "basic-auth",
  "correlation-id",
  "cors",
  "http-log",
  "ip-restriction",
  "jwt",
  "key-auth",
  "openid-connect",
  "proxy-cache",
  "rate-limiting",
  "request-size-limiting",
  "request-termination",
  "request-transformer",
  "response-transformer",
];

describe("plugin schemas", () => {
  it("covers every PRD v1 plugin", () => {
    expect([...PLUGIN_NAMES].sort()).toEqual(V1_PLUGINS);
  });

  it("isPluginName narrows known names only", () => {
    expect(isPluginName("key-auth")).toBe(true);
    expect(isPluginName("not-a-plugin")).toBe(false);
    expect(isPluginName("toString")).toBe(false);
  });

  it.each(PLUGIN_NAMES)("%s: jsonSchema is Kong's schema unchanged", (name) => {
    expect(jsonSchema(name)).toEqual(vendored(name));
  });

  // Pins the generated zod's behaviour across zod and generator upgrades.
  it.each(PLUGIN_NAMES)("%s: zod schema is stable", (name) => {
    expect(z.toJSONSchema(kongSchema(name), { io: "input" })).toMatchSnapshot();
  });
});

/** Kong-shaped plugin configs, validated by zod and by a JSON Schema validator alike. */
const SAMPLES: [PluginName, unknown, boolean][] = [
  [
    "key-auth",
    { config: { key_names: ["apikey"], hide_credentials: true } },
    true,
  ],
  ["key-auth", { config: { key_names: "apikey" } }, false],
  ["rate-limiting", { config: { minute: 30, policy: "local" } }, true],
  ["rate-limiting", { config: { minute: 30, policy: "nope" } }, false],
  ["proxy-cache", { config: { strategy: "memory", cache_ttl: 300 } }, true],
  [
    "cors",
    { config: { origins: ["https://example.com"], max_age: 3600 } },
    true,
  ],
  ["ip-restriction", { config: { allow: ["10.0.0.0/8"] } }, true],
  [
    "request-termination",
    { config: { status_code: 503, message: "down" } },
    true,
  ],
  ["request-termination", { config: { status_code: 99 } }, false],
  ["openid-connect", { config: { issuer: "https://idp.example.com" } }, true],
  ["openid-connect", { config: {} }, false],
  [
    "ai-proxy",
    { config: { route_type: "llm/v1/chat", model: { provider: "openai" } } },
    true,
  ],
  [
    "ai-proxy",
    { config: { route_type: "llm/v1/chat", model: { provider: "nope" } } },
    false,
  ],
];

describe("Kong config samples", () => {
  it.each(SAMPLES)("%s %j valid=%s", (name, config, valid) => {
    expect(kongSchema(name).safeParse(config).success).toBe(valid);
    expect(new Validator(vendored(name), "7").validate(config).valid).toBe(
      valid,
    );
  });

  it("applies Kong's defaults", () => {
    const parsed = kongSchema("key-auth").parse({ config: {} }) as {
      config: { key_names: string[]; key_in_header: boolean };
    };
    expect(parsed.config.key_names).toEqual(["apikey"]);
    expect(parsed.config.key_in_header).toBe(true);
  });
});
