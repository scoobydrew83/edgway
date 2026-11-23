/**
 * The SDK is generated from the admin's committed OpenAPI document
 * (apps/admin/openapi.json, written by `pnpm --filter @edgway/admin openapi`).
 * Output in src/generated is never edited by hand: run `pnpm run generate`.
 */
import { defineConfig } from "@hey-api/openapi-ts";

export default defineConfig({
  input: "../../apps/admin/openapi.json",
  // `.js` on relative imports: the built package is Node ESM.
  output: { path: "src/generated", importFileExtension: ".js" },
  plugins: [
    "@hey-api/client-fetch",
    { name: "zod" },
    { name: "@hey-api/sdk", validator: true },
    "@tanstack/react-query",
  ],
});
