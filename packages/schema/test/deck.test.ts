import { readdirSync, readFileSync } from "node:fs";
import { Validator } from "@cfworker/json-schema";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { isPluginName, kongSchema } from "../src/index";

const repo = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, repo), "utf8");

// The vendored decK file schema is draft-04.
const deck = new Validator(
  JSON.parse(read("vendor/kong-schemas/deck/kong_json_schema.json")),
  "4",
);

const FIXTURES = [
  "examples/deck/demo.yaml",
  ...readdirSync(new URL("examples/deck/kong/", repo))
    .filter((file) => file.endsWith(".yaml"))
    .map((file) => `examples/deck/kong/${file}`),
];

type Plugin = { name: string; config?: unknown; protocols?: unknown };

/** Every plugin entry, at any nesting level (top level, services, routes, consumers...). */
function pluginsIn(node: unknown): Plugin[] {
  if (Array.isArray(node)) return node.flatMap(pluginsIn);
  if (typeof node !== "object" || node === null) return [];
  return Object.entries(node).flatMap(([key, value]) => [
    ...(key === "plugins" && Array.isArray(value) ? (value as Plugin[]) : []),
    ...pluginsIn(value),
  ]);
}

describe.each(FIXTURES)("%s", (path) => {
  const file = parse(read(path));

  it("is a valid decK file", () => {
    const result = deck.validate(file);
    expect(result.errors).toEqual([]);
  });

  it("has plugin configs that match Kong's plugin schemas", () => {
    const plugins = pluginsIn(file);
    expect(plugins.length).toBeGreaterThan(0);
    for (const { name, config, protocols } of plugins) {
      if (!isPluginName(name))
        throw new Error(`${path}: no schema for ${name}`);
      // decK refers to routes/services/consumers by name; validate the plugin's own fields.
      const result = kongSchema(name).safeParse({ config, protocols });
      expect(result.error?.issues ?? [], `${path}: ${name}`).toEqual([]);
    }
  });
});

describe("demo.yaml", () => {
  it("reproduces the scaffold's seed routes", () => {
    const file = parse(read("examples/deck/demo.yaml")) as {
      services: {
        url: string;
        routes: { paths: string[]; methods: string[] }[];
      }[];
    };
    const routes = file.services.flatMap((service) =>
      service.routes.map((route) => ({
        url: service.url,
        paths: route.paths,
        methods: route.methods,
      })),
    );
    expect(routes).toEqual([
      {
        url: "https://httpbin.org/anything",
        paths: ["/demo/httpbin"],
        methods: ["GET", "POST"],
      },
      { url: "https://httpbin.org/ip", paths: ["/demo/ip"], methods: ["GET"] },
    ]);
  });

  it("rejects a decK file Kong would reject", () => {
    const bad = {
      _format_version: "3.0",
      services: [{ name: "s", port: "80" }],
    };
    expect(deck.validate(bad).valid).toBe(false);
  });

  it("rejects a plugin config Kong would reject", () => {
    const bad = kongSchema("rate-limiting").safeParse({
      config: { minute: "thirty" },
    });
    expect(bad.success).toBe(false);
  });
});
