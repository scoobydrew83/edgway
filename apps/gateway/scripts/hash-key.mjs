#!/usr/bin/env node
/** Usage: node scripts/hash-key.mjs '<raw-api-key>' */
import { createHash } from "node:crypto";

const raw = process.argv[2];
if (!raw) {
  console.error("Usage: node scripts/hash-key.mjs '<raw-api-key>'");
  process.exit(1);
}
console.log(createHash("sha256").update(raw, "utf8").digest("hex"));
