/**
 * `docs-gen` (register `docs-generators`): writes the docs site's generated
 * reference pages under apps/docs/content/docs
 * (`pnpm --filter @edgway/docs generate`). The output is committed, and a
 * rerun leaves it unchanged.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateFiles } from "fumadocs-openapi";
import { createOpenAPI } from "fumadocs-openapi/server";
import { errorPages } from "./errors";
import { writeDir } from "./mdx";
import { pluginPages } from "./plugins";

/** The admin's committed OpenAPI document, relative to apps/docs (the docs app reads the same path). */
export const ADMIN_OPENAPI = "../admin/openapi.json";

// Paths below (and the document path written into the API pages) are the
// docs app's own: work from apps/docs.
process.chdir(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../apps/docs"),
);
const content = path.resolve("content/docs");

writeDir(path.join(content, "errors"), errorPages());
writeDir(path.join(content, "plugins"), pluginPages());

const apiDir = path.join(content, "admin-api");
writeDir(apiDir, {
  "meta.json": `${JSON.stringify({ title: "Admin API" }, null, 2)}\n`,
});
await generateFiles({
  input: createOpenAPI({ input: [ADMIN_OPENAPI] }),
  output: apiDir,
  // One page: every generated page carries the whole document, so one per
  // operation would ship it ~90 times (and the document declares no tags).
  per: "file",
  includeDescription: true,
  frontmatter: () => ({
    title: "Admin API",
    description: "The native admin API (/api/v1), from its OpenAPI document.",
  }),
});
