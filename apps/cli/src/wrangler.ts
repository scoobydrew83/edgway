/** Runs the wrangler CLI (a dependency of this package). */
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { CLI } from "@edgway/constants";
import { cliDeployFailed, t } from "@edgway/i18n";

const bin = () => {
  const pkg = createRequire(import.meta.url).resolve("wrangler/package.json");
  return path.join(path.dirname(pkg), "bin", "wrangler.js");
};

/**
 * The environment wrangler runs with: this process's, without Workers Builds'
 * name override and tag check, which would deploy every Worker under the
 * name of the one the build is connected to.
 */
export function wranglerEnv(
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const {
    [CLI.env.workersBuildsName]: _name,
    [CLI.env.workersBuildsTag]: _tag,
    ...rest
  } = env;
  return rest;
}

export const commandLine = (args: string[]) => ["wrangler", ...args].join(" ");

const failed = (args: string[], code: number | null) =>
  new Error(
    t(cliDeployFailed, { command: commandLine(args), code: code ?? 1 }),
  );

/** Runs wrangler and waits for it, its output shown. */
export function wrangler(
  args: string[],
  options: { cwd: string; quiet?: boolean },
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bin(), ...args], {
      cwd: options.cwd,
      env: wranglerEnv(),
      stdio: options.quiet ? ["ignore", "ignore", "inherit"] : "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(failed(args, code)),
    );
  });
}

/**
 * Runs wrangler synchronously: its stdout is returned when `capture` is set,
 * `input` is its stdin (a secret's value, a prompt's answer).
 */
export function wranglerSync(
  args: string[],
  options: { cwd: string; capture?: boolean; input?: string },
): string {
  const result = spawnSync(process.execPath, [bin(), ...args], {
    cwd: options.cwd,
    env: wranglerEnv(),
    input: options.input,
    encoding: "utf8",
    stdio: [
      options.input === undefined ? "inherit" : "pipe",
      options.capture ? "pipe" : "inherit",
      "inherit",
    ],
  });
  if (result.status !== 0) throw failed(args, result.status);
  return result.stdout ?? "";
}
