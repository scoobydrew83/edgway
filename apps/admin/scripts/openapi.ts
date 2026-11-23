/**
 * Writes the native API's OpenAPI document to `openapi.json`, the input
 * @edgway/sdk is generated from. `test/api.test.ts` fails when the
 * committed file differs from what the Worker serves.
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { adminApi } from "../src/api";
import { OPENAPI_DOCUMENT } from "../src/openapi";

const file = fileURLToPath(new URL("../openapi.json", import.meta.url));
const document = adminApi().getOpenAPI31Document(OPENAPI_DOCUMENT);
writeFileSync(file, `${JSON.stringify(document, null, 2)}\n`);
// Biome's own JSON formatting, so `pnpm biome ci` accepts the file as written.
execFileSync("pnpm", ["exec", "biome", "format", "--write", file], {
  stdio: "inherit",
});
