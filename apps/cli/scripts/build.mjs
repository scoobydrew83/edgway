/**
 * Bundles the CLI into dist/index.js with esbuild: the
 * workspace packages are inlined (they ship TypeScript sources), the CLI's own
 * npm dependencies stay external and install with the package.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { build } from "esbuild";

const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);

const result = await build({
  entryPoints: [new URL("../src/index.ts", import.meta.url).pathname],
  outfile: new URL("../dist/index.js", import.meta.url).pathname,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  // Installed with the package: its dependencies and peers (wrangler).
  external: [
    ...Object.keys(pkg.dependencies),
    ...Object.keys(pkg.peerDependencies ?? {}),
  ],
  loader: { ".tmpl": "text" },
  define: { __EDGWAY_VERSION__: JSON.stringify(pkg.version) },
  // No comments in the bundle: dependencies' lint directives would trip the
  // repo's ESLint (it lints every .js file). Licence comments go to
  // dist/index.js.LEGAL.txt instead.
  minifyWhitespace: true,
  legalComments: "linked",
  banner: {
    // Bundled CommonJS dependencies may call require().
    js: "#!/usr/bin/env node\nimport { createRequire as __edgwayRequire } from 'node:module';\nconst require = __edgwayRequire(import.meta.url);",
  },
  logLevel: "warning",
  // Which npm packages the bundle inlines, for its notices.
  metafile: true,
});
const metafile = new URL("../dist/meta.json", import.meta.url).pathname;
// Inputs are relative to this directory: made absolute for the notices
// script, which runs from the workspace root.
writeFileSync(
  metafile,
  JSON.stringify({
    inputs: Object.fromEntries(
      Object.keys(result.metafile.inputs).map((input) => [
        path.resolve(input),
        {},
      ]),
    ),
  }),
);

// The CLI's third-party notices: its production dependency tree and
// the npm packages the bundle inlines. Shipped in dist/ with the bundle.
const notices = spawnSync(
  "pnpm",
  [
    "-w",
    "exec",
    "tsx",
    "tools/licenses/notices.ts",
    "cli",
    new URL("../dist/THIRD_PARTY_NOTICES.txt", import.meta.url).pathname,
    metafile,
  ],
  { stdio: "inherit" },
);
if (notices.status !== 0) process.exit(notices.status ?? 1);
rmSync(metafile);
