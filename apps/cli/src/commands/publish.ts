/** `edgway publish`: publishes the staged configuration (the publisher role). */
import { PUBLISH_WARNING } from "@edgway/constants";
import {
  cliPublishDescription,
  cliPublishDone,
  cliPublishOptionNote,
  cliPublishWarningAlgorithm,
  cliPublishWarningRawSecret,
  t,
} from "@edgway/i18n";
import { type PublishResponses, publish as publishConfig } from "@edgway/sdk";
import { defineCommand } from "citty";
import { adminClient, ok } from "../admin";
import { adminOptions, jsonOption, printJson } from "../args";

export const publish = defineCommand({
  meta: { name: "publish", description: t(cliPublishDescription) },
  args: {
    note: { type: "string", description: t(cliPublishOptionNote) },
    ...jsonOption,
    ...adminOptions,
  },
  async run({ args }) {
    const client = await adminClient(args);
    const result = ok(
      await publishConfig({
        client,
        body: args.note ? { note: args.note } : {},
      }),
    ) as PublishResponses[201];
    if (args.json) {
      printJson(result);
      return;
    }
    console.log(t(cliPublishDone, { version: result.version }));
    // What the publish went ahead with but says, on stderr.
    for (const warning of result.warnings ?? []) {
      console.error(
        warning.code === PUBLISH_WARNING.upstreamAlgorithm
          ? t(cliPublishWarningAlgorithm, {
              name: warning.name ?? warning.upstream,
              algorithm: warning.algorithm,
              runsAs: warning.runs_as,
            })
          : t(cliPublishWarningRawSecret, {
              name: warning.name,
              fields: warning.fields.join(", "),
            }),
      );
    }
  },
});
