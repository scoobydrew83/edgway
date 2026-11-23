/**
 * `pnpm gate`: runs the baseline checks, then every gate enabled in
 * tools/gates/gates.json via its root script `gate:<name>`. Exits non-zero if any fail.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

type GatesFile = { gates: Record<string, { enabled: boolean }> };

const { gates } = JSON.parse(
  readFileSync("tools/gates/gates.json", "utf8"),
) as GatesFile;

const steps: [string, string][] = [
  ["turbo", "pnpm turbo run typecheck lint test"],
  ["biome", "pnpm biome ci ."],
  ...Object.entries(gates)
    .filter(([, gate]) => gate.enabled)
    .map(([name]): [string, string] => [
      name,
      `pnpm run --silent gate:${name}`,
    ]),
];

const failed: string[] = [];
for (const [name, command] of steps) {
  console.log(`\n▶ gate ${name}: ${command}`);
  const { status } = spawnSync(command, { shell: true, stdio: "inherit" });
  if (status !== 0) failed.push(name);
}

const skipped = Object.entries(gates)
  .filter(([, gate]) => !gate.enabled)
  .map(([name]) => name);
console.log(
  `\ngate: ${steps.length - failed.length}/${steps.length} passed` +
    (skipped.length ? ` (not yet enabled: ${skipped.join(", ")})` : ""),
);
if (failed.length) {
  console.error(`gate: FAILED ${failed.join(", ")}`);
  process.exit(1);
}
