/**
 * Proves each gate fails on its bad fixture and passes on its good fixture.
 * Usage: pnpm gate:test
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  symlinkSync,
} from "node:fs";
import path from "node:path";

const repo = process.cwd();
const fixtures = path.join(repo, "tools/gates/fixtures");
const bin = (name: string) => path.join(repo, "node_modules/.bin", name);

type Case = {
  gate: string;
  fixture: string;
  expect: "pass" | "fail";
  cmd: string;
  cwd?: string;
};

const depcruise = `${bin("depcruise")} . --config ${path.join(repo, ".dependency-cruiser.cjs")}`;
const register = `${bin("tsx")} ${path.join(repo, "tools/gates/register-check.ts")} --root`;
const knip = `${bin("knip")} --no-progress --no-config-hints --directory`;
const formatjsVerify = (dir: string) =>
  `${path.join(repo, "packages/i18n/node_modules/.bin/formatjs")} verify --source-locale en --missing-keys --extra-keys --structural-equality "${dir}/*.json"`;
const eslint = `${bin("eslint")} --config ${path.join(repo, "eslint.config.js")} .`;
const licences = `${bin("tsx")} ${path.join(repo, "tools/gates/licence-check.ts")} --json`;
const sgScan = `${bin("ast-grep")} scan --config ${path.join(repo, "sgconfig.yml")}`;

/**
 * Workspace packages resolve by name through node_modules links, as pnpm makes
 * them. Git ignores node_modules, so link each fixture's packages at run time.
 */
function linkWorkspacePackages(fixtureDir: string) {
  const packagesDir = path.join(fixtureDir, "packages");
  if (!existsSync(packagesDir)) return;
  for (const pkg of readdirSync(packagesDir)) {
    const manifest = path.join(packagesDir, pkg, "package.json");
    if (!existsSync(manifest)) continue;
    const { name } = JSON.parse(readFileSync(manifest, "utf8")) as {
      name: string;
    };
    const link = path.join(fixtureDir, "node_modules", name);
    if (existsSync(link)) continue;
    mkdirSync(path.dirname(link), { recursive: true });
    symlinkSync(
      path.relative(path.dirname(link), path.join(packagesDir, pkg)),
      link,
      "dir",
    );
  }
}
for (const dir of readdirSync(path.join(fixtures, "boundaries"))) {
  linkWorkspacePackages(path.join(fixtures, "boundaries", dir));
}

const cases: Case[] = [
  // One fixture per boundaries rule; only "good" may pass.
  ...readdirSync(path.join(fixtures, "boundaries")).map(
    (dir): Case => ({
      gate: "boundaries",
      fixture: dir,
      expect: dir === "good" ? "pass" : "fail",
      cmd: depcruise,
      cwd: `boundaries/${dir}`,
    }),
  ),
  // i18n: catalog checks (formatjs verify), unused messages (knip), literals (ESLint).
  ...readdirSync(path.join(fixtures, "i18n-catalog")).map(
    (dir): Case => ({
      gate: "i18n",
      fixture: `catalog ${dir}`,
      expect: dir === "good" ? "pass" : "fail",
      cmd: formatjsVerify(`${fixtures}/i18n-catalog/${dir}`),
    }),
  ),
  ...["good", "bad"].map(
    (dir): Case => ({
      gate: "i18n",
      fixture: `unused message ${dir}`,
      expect: dir === "good" ? "pass" : "fail",
      cmd: `${knip} ${fixtures}/i18n-unused/${dir}`,
    }),
  ),
  ...["good", "bad"].map(
    (dir): Case => ({
      gate: "i18n",
      fixture: `lint ${dir}`,
      expect: dir === "good" ? "pass" : "fail",
      cmd: eslint,
      cwd: `i18n-lint/${dir}`,
    }),
  ),
  {
    gate: "register",
    fixture: "good",
    expect: "pass",
    cmd: `${register} ${fixtures}/register/good`,
  },
  {
    gate: "register",
    fixture: "bad",
    expect: "fail",
    cmd: `${register} ${fixtures}/register/bad`,
  },
  {
    gate: "register",
    fixture: "expired",
    expect: "fail",
    cmd: `${register} ${fixtures}/register/expired`,
  },
  {
    gate: "knip",
    fixture: "good",
    expect: "pass",
    cmd: `${knip} ${fixtures}/knip/good`,
  },
  {
    gate: "knip",
    fixture: "bad",
    expect: "fail",
    cmd: `${knip} ${fixtures}/knip/bad`,
  },
  // licences: a GPL dependency fails, alone or in a compound expression;
  // permissive, MPL-or-Apache, MIT-and-ISC and zudoku (allowed by its
  // LICENSE file) pass.
  ...["good", "bad", "compound"].map(
    (name): Case => ({
      gate: "licences",
      fixture: name,
      expect: name === "good" ? "pass" : "fail",
      cmd: `${licences} ${fixtures}/licences/${name}.json`,
    }),
  ),
  {
    gate: "centralization",
    fixture: "rule tests",
    expect: "pass",
    cmd: `${bin("ast-grep")} test --config ${path.join(repo, "sgconfig.yml")} --skip-snapshot-tests`,
  },
  {
    gate: "centralization",
    fixture: "good",
    expect: "pass",
    cmd: `${sgScan} ${fixtures}/centralization/good`,
  },
  {
    gate: "centralization",
    fixture: "bad",
    expect: "fail",
    cmd: `${sgScan} ${fixtures}/centralization/bad`,
  },
];

let wrong = 0;
for (const c of cases) {
  const cwd = c.cwd ? path.join(fixtures, c.cwd) : repo;
  if (!existsSync(cwd)) throw new Error(`gate:test: missing fixture ${cwd}`);
  const { status } = spawnSync(c.cmd, { shell: true, cwd, stdio: "pipe" });
  // A real violation exits with a small positive code; null, 126 and 127 mean
  // the tool never ran, which must not count as an expected failure.
  const crashed = status === null || status === 126 || status === 127;
  const got = status === 0 ? "pass" : crashed ? "crash" : "fail";
  const ok = got === c.expect;
  if (!ok) wrong++;
  console.log(
    `${ok ? "ok  " : "FAIL"} ${c.gate} / ${c.fixture}: expected ${c.expect}, got ${got}`,
  );
}
if (wrong) {
  console.error(`gate:test: ${wrong} case(s) did not behave as expected`);
  process.exit(1);
}
console.log(`gate:test: all ${cases.length} cases behaved as expected`);
