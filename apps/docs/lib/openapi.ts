import { createOpenAPI } from "fumadocs-openapi/server";

/**
 * The admin API's committed OpenAPI document (apps/admin/openapi.json), at
 * the path tools/docs-gen wrote into the generated pages.
 */
export const openapi = createOpenAPI({ input: ["../admin/openapi.json"] });
