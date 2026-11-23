/**
 * `edgway deploy`: provisions KV and D1, applies the admin's migrations,
 * deploys the admin, gateway and portal, and installs the key pairs on a
 * first deploy (../deploy.ts). `pnpm run deploy` runs this command
 * (tools/deploy.mjs). `--dry-run` bundles and checks the three Workers and
 * touches nothing remote.
 */
import {
  cliDeployChecked,
  cliDeployDescription,
  cliDeployDone,
  cliDeployOptionDryRun,
  t,
} from "@edgway/i18n";
import { defineCommand } from "citty";
import { cwdArg, cwdOption } from "../args";
import { readConfig } from "../config";
import { deployEdgway } from "../deploy";

export const deploy = defineCommand({
  meta: { name: "deploy", description: t(cliDeployDescription) },
  args: {
    "dry-run": { type: "boolean", description: t(cliDeployOptionDryRun) },
    ...cwdOption,
  },
  async run({ args }) {
    const config = await readConfig(cwdArg(args));
    const dryRun = Boolean(args["dry-run"]);
    await deployEdgway({
      root: config.cwd,
      admin: config.adminConfig,
      gateway: config.gatewayConfig,
      portal: config.portalConfig,
      dryRun,
    });
    console.log(t(dryRun ? cliDeployChecked : cliDeployDone));
  },
});
