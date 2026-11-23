/**
 * Regenerates src/generated/plugins.ts from the repo root's
 * edgway.config.json (`pnpm gen:plugins`), the list the admin's registry is
 * generated from too.
 */
import { fileURLToPath } from "node:url";
import { generateRegistry } from "@edgway/plugin-sdk/registry";

const app = fileURLToPath(new URL("..", import.meta.url));
await generateRegistry({
  cwd: fileURLToPath(new URL("../../..", import.meta.url)),
  outFile: `${app}src/generated/plugins.ts`,
});
