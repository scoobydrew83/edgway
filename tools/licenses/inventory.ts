/**
 * The production dependencies of Edgway's shipped artifacts and their
 * licences, from `pnpm licenses list --prod --json`: pnpm resolves
 * the transitive tree and each package's install path. Shared by the
 * licence gate and the notices generator.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/** One package as `pnpm licenses list --json` reports it. */
export interface LicensedPackage {
  name: string;
  versions: string[];
  paths: string[];
  license: string;
  author?: string;
  homepage?: string;
}

/** pnpm's output: packages grouped by licence expression. */
export type LicenseReport = Record<string, LicensedPackage[]>;

/** The shipped artifacts (workspace package names), by what they ship as. */
export const ARTIFACTS = {
  cli: "edgway",
  ui: "@edgway/ui",
  portal: "@edgway/portal",
  gateway: "@edgway/gateway",
  admin: "@edgway/admin",
} as const;
export type Artifact = keyof typeof ARTIFACTS;

/**
 * `pnpm licenses list --prod --json` for some workspace packages and the
 * workspace packages they depend on (`<name>...`): an app bundles its
 * workspace packages, so their npm dependencies ship with it too.
 */
export function licenseReport(packages: readonly string[]): LicenseReport {
  const filters = packages.flatMap((name) => ["--filter", `${name}...`]);
  const run = spawnSync(
    "pnpm",
    ["licenses", "list", "--prod", "--json", ...filters],
    { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  );
  if (run.status !== 0) {
    throw new Error(`pnpm licenses failed: ${run.stderr}`);
  }
  const report = JSON.parse(run.stdout) as LicenseReport;
  return merge(report, copiedCode(packages));
}

/** The directory of code copied into a workspace package. */
const COPIED_DIR = "third-party";
const COPIED_META = "third-party.json";

/**
 * Code copied into the workspace packages that some packages bundle
 *: each `third-party/<upstream>/` holds the upstream's licence
 * files and a `third-party.json` naming it. Reported like a dependency, so
 * the gate checks its licence and the notices reproduce its texts.
 */
function copiedCode(packages: readonly string[]): LicensedPackage[] {
  const filters = packages.flatMap((name) => ["--filter", `${name}...`]);
  const run = spawnSync(
    "pnpm",
    ["ls", "-r", "--depth", "-1", "--json", ...filters],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  if (run.status !== 0) throw new Error(`pnpm ls failed: ${run.stderr}`);
  const projects = JSON.parse(run.stdout) as { path: string }[];
  return projects.flatMap(({ path: root }) => {
    const dir = path.join(root, COPIED_DIR);
    if (!existsSync(dir)) return [];
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const upstream = path.join(dir, entry.name);
        const meta = JSON.parse(
          readFileSync(path.join(upstream, COPIED_META), "utf8"),
        ) as {
          name: string;
          version: string;
          license: string;
          homepage?: string;
        };
        return {
          name: meta.name,
          versions: [meta.version],
          paths: [upstream],
          license: meta.license,
          homepage: meta.homepage,
        };
      });
  });
}

/** A report from a file (the gate's fixtures). */
export const readReport = (file: string): LicenseReport =>
  JSON.parse(readFileSync(file, "utf8")) as LicenseReport;

/** Every package in a report once, sorted by name. */
export function packagesOf(report: LicenseReport): LicensedPackage[] {
  const all = new Map<string, LicensedPackage>();
  for (const [license, packages] of Object.entries(report)) {
    for (const pkg of packages) {
      const key = `${pkg.name}@${pkg.versions.join(",")}`;
      if (!all.has(key)) all.set(key, { ...pkg, license });
    }
  }
  return [...all.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The npm packages an esbuild bundle inlined, from its metafile's inputs
 * (pnpm installs each at `node_modules/.pnpm/<id>/node_modules/<name>`),
 * read from their own package.json files.
 */
export function bundledPackages(metafile: string): LicensedPackage[] {
  const { inputs } = JSON.parse(readFileSync(metafile, "utf8")) as {
    inputs: Record<string, unknown>;
  };
  const dirs = new Set<string>();
  for (const input of Object.keys(inputs)) {
    const match = /^(.*node_modules\/(?:@[^/]+\/)?[^/@][^/]*)\//.exec(
      input.split(path.sep).join("/"),
    );
    if (match?.[1] && !match[1].includes("/.pnpm/node_modules/")) {
      dirs.add(path.resolve(match[1]));
    }
  }
  return [...dirs].map((dir) => {
    const pkg = JSON.parse(
      readFileSync(path.join(dir, "package.json"), "utf8"),
    ) as { name: string; version: string; license?: string; homepage?: string };
    return {
      name: pkg.name,
      versions: [pkg.version],
      paths: [dir],
      license: pkg.license ?? "Unknown",
      homepage: pkg.homepage,
    };
  });
}

/** Two package lists as one report (by licence). */
export function merge(
  report: LicenseReport,
  more: readonly LicensedPackage[],
): LicenseReport {
  const out: LicenseReport = structuredClone(report);
  for (const pkg of more) {
    out[pkg.license] = [...(out[pkg.license] ?? []), pkg];
  }
  return out;
}
