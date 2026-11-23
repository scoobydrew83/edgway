/**
 * `node tools/release/check-packs.mjs` (CI's `pack` job): packs every public workspace package the way
 * `pnpm publish` would (prepack builds `dist` and copies LICENSE and NOTICE,
 * `publishConfig` rewrites the exports), then checks each tarball:
 * LICENSE and NOTICE are inside, publint finds nothing, and
 * arethetypeswrong resolves every export for ESM consumers. The CLI ships
 * only a `bin`, so it has no exports for arethetypeswrong to check. Last,
 * the tarballs are installed together into an empty npm project, the way a
 * consumer gets them, and every export is imported under Node. Node has no
 * `cloudflare:*` modules, so a loader hook stands in for the names the
 * Workers-only entry points import (`DurableObject` from `cloudflare:workers`,
 * the ExecutionContext helpers from `cloudflare:test`) while every other
 * import resolves for real.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Pinned exactly (pre-1.0), and run with `pnpm dlx` so the checkers stay
// release tooling rather than workspace dependencies.
const PUBLINT = "publint@0.3.25";
const ATTW = "@arethetypeswrong/cli@0.18.5";

const root = path.resolve(import.meta.dirname, "../..");
const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { cwd: root, encoding: "utf8", ...opts });

const workspace = JSON.parse(
  run("pnpm", ["-r", "ls", "--json", "--depth", "-1"]),
);
const publics = workspace.filter((p) => !p.private && p.path !== root);
if (publics.length === 0) throw new Error("no public packages found");

const out = mkdtempSync(path.join(tmpdir(), "edgway-packs-"));
const failures = [];
const manifests = [];
const tarballs = [];
try {
  run(
    "pnpm",
    [
      ...publics.flatMap((p) => ["--filter", p.name]),
      "-r",
      "pack",
      "--pack-destination",
      out,
    ],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
  for (const pkg of publics) {
    const manifest = JSON.parse(
      run("node", ["-p", "JSON.stringify(require('./package.json'))"], {
        cwd: pkg.path,
      }),
    );
    manifests.push(manifest);
    const tarball = path.join(
      out,
      `${pkg.name.replace(/^@/, "").replace("/", "-")}-${pkg.version}.tgz`,
    );
    tarballs.push(tarball);
    const entries = run("tar", ["-tzf", tarball]).split("\n");
    for (const file of ["LICENSE", "NOTICE"]) {
      if (!entries.includes(`package/${file}`))
        failures.push(`${pkg.name}: ${file} missing from the tarball`);
    }
    try {
      run("pnpm", ["dlx", PUBLINT, "run", "--strict", tarball], {
        stdio: "pipe",
      });
    } catch (error) {
      failures.push(`${pkg.name}: publint\n${error.stdout}${error.stderr}`);
    }
    if (manifest.exports) {
      try {
        run(
          "pnpm",
          [
            "dlx",
            "--package",
            ATTW,
            "attw",
            tarball,
            "--profile",
            "esm-only",
            "--format",
            "ascii",
          ],
          {
            stdio: "pipe",
          },
        );
      } catch (error) {
        failures.push(
          `${pkg.name}: arethetypeswrong\n${error.stdout}${error.stderr}`,
        );
      }
    }
    console.log(`checked ${pkg.name}`);
  }

  const consumer = path.join(out, "consumer");
  mkdirSync(consumer);
  writeFileSync(
    path.join(consumer, "package.json"),
    '{"private":true,"type":"module"}',
  );
  run("npm", ["install", "--no-audit", "--no-fund", ...tarballs], {
    cwd: consumer,
    stdio: "pipe",
  });
  const stub =
    "export class DurableObject {}" +
    "export function createExecutionContext() {}" +
    "export function waitOnExecutionContext() {}";
  const hooks = `export async function resolve(specifier, context, next) {
    if (specifier.startsWith("cloudflare:")) {
      return { url: ${JSON.stringify(`data:text/javascript,${encodeURIComponent(stub)}`)}, shortCircuit: true };
    }
    return next(specifier, context);
  }`;
  writeFileSync(
    path.join(consumer, "workers-runtime.mjs"),
    `import { register } from "node:module";\nregister(${JSON.stringify(`data:text/javascript,${encodeURIComponent(hooks)}`)});\n`,
  );
  for (const { name, exports } of manifests) {
    for (const subpath of Object.keys(exports ?? {})) {
      const specifier = subpath === "." ? name : `${name}/${subpath.slice(2)}`;
      try {
        run(
          "node",
          [
            "--import=./workers-runtime.mjs",
            "--input-type=module",
            "-e",
            `await import(${JSON.stringify(specifier)})`,
          ],
          {
            cwd: consumer,
            stdio: "pipe",
          },
        );
      } catch (error) {
        failures.push(
          `${specifier}: import failed in a consumer\n${error.stderr}`,
        );
      }
    }
  }
} finally {
  rmSync(out, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(failures.join("\n\n"));
  process.exit(1);
}
console.log(`${publics.length} packages pack cleanly`);
