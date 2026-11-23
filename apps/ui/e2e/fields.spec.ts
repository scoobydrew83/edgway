/** every field the admin API takes has an @edgway/i18n label (a unit test, no browser). */
import * as sdk from "@edgway/sdk";
import { expect, test } from "@playwright/test";
import { z } from "zod";
import { FIELD_LABELS } from "../src/fields";

test("every create body's field has a label", () => {
  const fields = new Set<string>();
  for (const [name, schema] of Object.entries(sdk)) {
    if (/^zCreate.*Body$/.test(name) && schema instanceof z.ZodObject) {
      for (const field of Object.keys(schema.shape)) fields.add(field);
    }
  }
  expect(fields.size).toBeGreaterThan(50);
  expect([...fields].filter((field) => !FIELD_LABELS[field])).toEqual([]);
});
