/**
 * `edgway init`: asks for the admin URL and the three wrangler configs
 * (@clack/prompts) and writes `edgway.config.ts`, generated with knitwork.
 * Without a TTY it doesn't prompt and takes the defaults.
 */
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { cancel, intro, isCancel, outro, text } from "@clack/prompts";
import { CLI } from "@edgway/constants";
import {
  cliDescription,
  cliInitAdminConfig,
  cliInitAdminUrl,
  cliInitCancelled,
  cliInitDescription,
  cliInitExists,
  cliInitGatewayConfig,
  cliInitOptionForce,
  cliInitOptionYes,
  cliInitPortalConfig,
  cliInitWritten,
  t,
} from "@edgway/i18n";
import { defineCommand } from "citty";
import { genObjectFromValues } from "knitwork";
import template from "../../templates/edgway.config.ts.tmpl";
import { cwdArg, cwdOption } from "../args";
import { DEFAULT_CONFIG, type EdgwayConfig } from "../config";

/** The config file's source. */
const configSource = (config: EdgwayConfig) =>
  template.replace("__CONFIG__", genObjectFromValues(config));

async function ask(message: string, initialValue: string) {
  const value = await text({
    message,
    initialValue,
    defaultValue: initialValue,
  });
  if (isCancel(value)) {
    cancel(t(cliInitCancelled));
    process.exit(1);
  }
  return value;
}

export const init = defineCommand({
  meta: { name: "init", description: t(cliInitDescription) },
  args: {
    yes: { type: "boolean", description: t(cliInitOptionYes) },
    force: { type: "boolean", description: t(cliInitOptionForce) },
    "admin-url": { type: "string", description: t(cliInitAdminUrl) },
    ...cwdOption,
  },
  async run({ args }) {
    const file = path.join(cwdArg(args), CLI.configFile);
    if (existsSync(file) && !args.force) {
      throw new Error(t(cliInitExists, { file: CLI.configFile }));
    }
    const config: EdgwayConfig = {
      adminUrl: args["admin-url"] ?? DEFAULT_CONFIG.adminUrl,
      admin: { config: CLI.adminConfig },
      gateway: { config: CLI.gatewayConfig },
      portal: { config: CLI.portalConfig },
    };
    // Without a terminal (CI, a pipe) there is no one to ask: take the
    // defaults, as --yes does.
    const prompt = !args.yes && Boolean(process.stdin.isTTY);
    if (prompt) {
      intro(t(cliDescription));
      config.adminUrl = await ask(t(cliInitAdminUrl), config.adminUrl ?? "");
      config.admin = {
        config: await ask(t(cliInitAdminConfig), CLI.adminConfig),
      };
      config.gateway = {
        config: await ask(t(cliInitGatewayConfig), CLI.gatewayConfig),
      };
      config.portal = {
        config: await ask(t(cliInitPortalConfig), CLI.portalConfig),
      };
    }
    writeFileSync(file, configSource(config));
    const done = t(cliInitWritten, { file: CLI.configFile });
    if (prompt) outro(done);
    else console.log(done);
  },
});
