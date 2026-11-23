/** Options several commands share. */
import path from "node:path";
import {
  cliOptionAdminUrl,
  cliOptionCwd,
  cliOptionJson,
  cliOptionToken,
  t,
} from "@edgway/i18n";

export const cwdOption = {
  cwd: { type: "string", description: t(cliOptionCwd) },
} as const;

export const adminOptions = {
  ...cwdOption,
  "admin-url": { type: "string", description: t(cliOptionAdminUrl) },
  token: { type: "string", description: t(cliOptionToken) },
} as const;

export const jsonOption = {
  json: { type: "boolean", description: t(cliOptionJson) },
} as const;

/** Prints `value` as JSON (the --json output of a command). */
export const printJson = (value: unknown) =>
  console.log(JSON.stringify(value, null, 2));

export const cwdArg = (args: { cwd?: string }) =>
  path.resolve(args.cwd || process.cwd());
