/**
 * Internal link check, with Fumadocs' next-validate-link: every
 * link in the content must reach a page this site builds. The pages are the
 * content files themselves (the catch-all docs route, at the site root),
 * since `lib/source.ts` only loads under the bundler. External links are
 * not fetched; heading fragments aren't checked.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  printErrors,
  readFiles,
  scanURLs,
  validateFiles,
} from "next-validate-link";

process.chdir(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));

const CONTENT = "content/docs";

/** A content file's URL: its path under content/docs, `index` dropped. */
const urlOf = (file) => {
  const slug = path
    .relative(CONTENT, file)
    .replace(/\.mdx?$/, "")
    .split(path.sep)
    .filter((part) => part !== "index");
  return `/${slug.join("/")}`;
};

const files = await readFiles(`${CONTENT}/**/*.{md,mdx}`, {
  pathToUrl: urlOf,
});

const scanned = await scanURLs({
  preset: "next",
  populate: {
    "(docs)/[[...slug]]": files.map((file) => ({
      value: { slug: urlOf(file.path).split("/").filter(Boolean) },
    })),
  },
});

printErrors(
  await validateFiles(files, {
    scanned,
    ignoreFragment: true,
    checkRelativePaths: "as-url",
    pathToUrl: urlOf,
  }),
  true,
);
