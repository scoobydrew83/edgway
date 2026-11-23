/**
 * Where an error code's docs page lives: the admin UI links each
 * error to it. The generated page in the repository, until the docs site
 * has a public home; the path is the registry's `docsPath`.
 */
import { docsPath } from "./registry.js";

const GENERATED_DOCS =
  "https://github.com/scoobydrew83/edgway/blob/main/apps/docs/content/docs";

export const errorDocsUrl = (code: string) =>
  `${GENERATED_DOCS}${docsPath({ code })}.mdx`;
