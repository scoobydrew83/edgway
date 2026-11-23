/**
 * `register` gate: every source file outside src/generated/ must be claimed by an entry
 * (custom code with a reason) or a wrapper in docs/custom-code-register.yaml.
 * Entries with `expires: T-xxx` fail once that queue task is approved.
 *
 * Usage: tsx tools/gates/register-check.ts [--root <dir>]
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import fg from "fast-glob";
import { parse } from "yaml";

type Claim = {
  name?: string;
  library?: string;
  paths: string[];
  expires?: string;
};
type Register = { entries?: Claim[]; wrappers?: Claim[] };

const rootFlag = process.argv.indexOf("--root");
const root =
  rootFlag > -1 ? path.resolve(process.argv[rootFlag + 1]) : process.cwd();
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

const register = parse(read("docs/custom-code-register.yaml")) as Register;
const claims = [...(register.entries ?? []), ...(register.wrappers ?? [])];

const sources = fg.sync(["{apps,packages,plugins}/*/src/**/*.{ts,tsx}"], {
  cwd: root,
  // Generator output lives in src/generated/ (SDK, Kong zod codegen, Paraglide).
  ignore: ["*/*/src/generated/**", "**/*.d.ts"],
});

const claimed = new Set(
  claims.flatMap((claim) => fg.sync(claim.paths, { cwd: root, dot: true })),
);
const unclaimed = sources.filter((file) => !claimed.has(file));

const queue = (() => {
  try {
    return read("loops/QUEUE.md");
  } catch {
    return "";
  }
})();
const expired = (register.entries ?? []).filter(
  (entry) =>
    entry.expires &&
    new RegExp(`### ${entry.expires}:[^\\n]*\\n- Status: approved`).test(queue),
);

for (const file of unclaimed) {
  console.error(
    `register: ${file} is not claimed by any register entry or wrapper`,
  );
}
for (const entry of expired) {
  console.error(
    `register: entry "${entry.name}" expired with ${entry.expires}; remove it`,
  );
}
if (unclaimed.length || expired.length) process.exit(1);
console.log(`register: ${sources.length} source files, all claimed`);
