/**
 * The `licences` gate: every production dependency of a shipped
 * artifact must be under an allowed licence. An SPDX `OR` needs one allowed
 * term, `AND` needs all of them. It also checks that the committed
 * THIRD_PARTY_NOTICES.txt is what `pnpm licenses:notices` generates now.
 *
 * Usage: tsx tools/gates/licence-check.ts [--json <pnpm licenses report>]
 */
import { readFileSync } from "node:fs";
import {
  ARTIFACTS,
  type LicenseReport,
  licenseReport,
  packagesOf,
  readReport,
} from "../licenses/inventory";
import { notices, WORKERS_NOTICES, workersReport } from "../licenses/notices";

/**
 * Permissive licences, plus MPL-2.0: weak, file-level
 * copyleft, so using it unmodified only keeps its notices. A change to an
 * MPL-2.0 file must be published under the MPL.
 */
const ALLOWED = new Set([
  "MIT",
  "ISC",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "Apache-2.0",
  "0BSD",
  "BlueOak-1.0.0",
  "CC0-1.0",
  "Unlicense",
  "Python-2.0",
  "MPL-2.0",
  // Fonts only: IBM Plex through @fontsource.
  "OFL-1.1",
]);

/**
 * Packages whose package.json has no `license` field, checked by hand
 * against their LICENSE file.
 */
const BY_LICENSE_FILE: Record<string, string> = {
  zudoku: "MIT",
};

/**
 * Whether an SPDX expression is satisfied by the allow-list. Only the
 * shapes npm packages use are read: one licence, or a flat `OR` or `AND`
 * list, in at most one outer pair of parentheses. Anything else (nested
 * parentheses, `AND` with `OR`, `WITH` exceptions) fails closed, for a
 * person to judge.
 */
export function allowed(expression: string): boolean {
  let text = expression.trim();
  if (/^\(.*\)$/.test(text)) text = text.slice(1, -1).trim();
  if (/[()]/.test(text) || /\sWITH\s/i.test(text)) return false;
  const or = text.split(/\s+OR\s+/i);
  const and = text.split(/\s+AND\s+/i);
  if (or.length > 1 && and.length > 1) return false;
  if (or.length > 1) return or.some((id) => ALLOWED.has(id));
  return and.every((id) => ALLOWED.has(id));
}

const args = process.argv.slice(2);
const file = args[args.indexOf("--json") + 1];
const fixture = args.includes("--json") && file;
const report: LicenseReport = fixture
  ? readReport(file)
  : licenseReport(Object.values(ARTIFACTS));

const refused = packagesOf(report).filter((pkg) => {
  const license = BY_LICENSE_FILE[pkg.name] ?? pkg.license;
  return !allowed(license);
});
for (const pkg of refused) {
  console.error(
    `licences: ${pkg.name}@${pkg.versions.join(",")} is ${pkg.license}, not on the allow-list`,
  );
}

let stale = false;
if (!fixture) {
  const committed = readFileSync(WORKERS_NOTICES, "utf8");
  if (committed !== notices(workersReport())) {
    stale = true;
    console.error(
      `licences: ${WORKERS_NOTICES} is out of date: run pnpm licenses:notices`,
    );
  }
}

if (refused.length > 0 || stale) process.exit(1);
console.log(`licences: ${packagesOf(report).length} packages, all allowed`);
