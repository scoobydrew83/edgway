/** `edgway rollback <version>`: makes an earlier published version live (the publisher role). */
import {
  cliRollbackDescription,
  cliRollbackDone,
  cliRollbackInvalidVersion,
  cliRollbackOptionVersion,
  t,
} from "@edgway/i18n";
import { rollback as rollbackConfig } from "@edgway/sdk";
import { defineCommand } from "citty";
import { adminClient, ok } from "../admin";
import { adminOptions, jsonOption, printJson } from "../args";

export const rollback = defineCommand({
  meta: { name: "rollback", description: t(cliRollbackDescription) },
  args: {
    version: {
      type: "positional",
      required: true,
      description: t(cliRollbackOptionVersion),
    },
    ...jsonOption,
    ...adminOptions,
  },
  async run({ args }) {
    const version = Number(args.version);
    if (!Number.isInteger(version) || version < 1) {
      throw new Error(t(cliRollbackInvalidVersion));
    }
    const client = await adminClient(args);
    const result = ok(await rollbackConfig({ client, body: { version } })) as {
      version: number;
    };
    if (args.json) printJson(result);
    else console.log(t(cliRollbackDone, { version: result.version }));
  },
});
