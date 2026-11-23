/**
 * every catalog plugin has a layout, and each layout names only
 * fields of its plugin's Kong schema (a unit test, no browser).
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
  PLUGIN_FIELD_LABELS,
  PLUGIN_LAYOUTS,
} from "../src/console/plugin-layouts";

const SCHEMAS = path.resolve(
  import.meta.dirname,
  "../../../vendor/kong-schemas/3.9/plugins",
);
const catalog = readdirSync(SCHEMAS)
  .filter((file) => file.endsWith(".json"))
  .map((file) => file.replace(/\.json$/, ""));

const configFields = (name: string): string[] =>
  Object.keys(
    JSON.parse(readFileSync(path.join(SCHEMAS, `${name}.json`), "utf8"))
      .properties.config.properties,
  );

test("every catalog plugin has a layout", () => {
  expect(catalog.length).toBeGreaterThan(10);
  expect(catalog.filter((name) => !PLUGIN_LAYOUTS[name])).toEqual([]);
});

test("each layout names only its plugin's Kong fields, each labelled", () => {
  for (const [name, layout] of Object.entries(PLUGIN_LAYOUTS)) {
    const fields = configFields(name);
    for (const field of layout.groups.flatMap((g) => g.rows.flat())) {
      expect(fields, `${name}.${field}`).toContain(field);
      expect(PLUGIN_FIELD_LABELS[field], `${name}.${field}`).toBeDefined();
    }
    for (const field of Object.keys(layout.fieldHints ?? {})) {
      expect(fields, `${name}.${field}`).toContain(field);
    }
  }
});
