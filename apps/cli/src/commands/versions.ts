/** `edgway versions`: the published config versions, newest first, the live one marked. */
import {
  cliVersionsDescription,
  cliVersionsLine,
  cliVersionsLiveLine,
  cliVersionsNone,
  cliVersionsNote,
  t,
} from "@edgway/i18n";
import { listVersions } from "@edgway/sdk";
import { defineCommand } from "citty";
import { adminClient, ok } from "../admin";
import { adminOptions, jsonOption, printJson } from "../args";

interface Version {
  version: number;
  /** Unix seconds. */
  created_at: number;
  created_by: string;
  note?: string | null;
}

export const versions = defineCommand({
  meta: { name: "versions", description: t(cliVersionsDescription) },
  args: { ...jsonOption, ...adminOptions },
  async run({ args }) {
    const client = await adminClient(args);
    const listed = ok(await listVersions({ client })) as {
      current?: number;
      data: Version[];
    };
    if (args.json) return printJson(listed);
    if (listed.data.length === 0) return console.log(t(cliVersionsNone));
    for (const v of listed.data) {
      const line =
        v.version === listed.current ? cliVersionsLiveLine : cliVersionsLine;
      console.log(
        t(line, {
          version: v.version,
          publishedAt: new Date(v.created_at * 1000).toISOString(),
          actor: v.created_by,
        }),
      );
      if (v.note) console.log(`  ${t(cliVersionsNote, { note: v.note })}`);
    }
  },
});
