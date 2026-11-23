/**
 * `edgway diff`: the admin's pending changes (staged in D1, not yet
 * published), one line per change; changed values are diffed with jsdiff.
 */
import { styleText } from "node:util";
import {
  cliDiffDescription,
  cliDiffNone,
  cliDiffOptionExitCode,
  cliDiffSummary,
  t,
} from "@edgway/i18n";
import { pendingChanges } from "@edgway/sdk";
import { defineCommand } from "citty";
import { diffJson } from "diff";
import { adminClient, ok } from "../admin";
import { adminOptions, jsonOption, printJson } from "../args";

interface Change {
  type: "CREATE" | "REMOVE" | "CHANGE";
  path: (string | number)[];
  value?: unknown;
  oldValue?: unknown;
}

const json = (value: unknown) => JSON.stringify(value);

/** The lines `edgway diff` prints for one change. */
function renderChange(change: Change): string[] {
  const at = change.path.join(".");
  if (change.type === "CREATE") {
    return [styleText("green", `+ ${at} ${json(change.value)}`)];
  }
  if (change.type === "REMOVE") {
    return [styleText("red", `- ${at} ${json(change.oldValue)}`)];
  }
  const lines = [styleText("yellow", `~ ${at}`)];
  for (const part of diffJson(
    change.oldValue as object,
    change.value as object,
  )) {
    for (const line of part.value.split("\n").filter(Boolean)) {
      if (part.added) lines.push(styleText("green", `  + ${line}`));
      else if (part.removed) lines.push(styleText("red", `  - ${line}`));
    }
  }
  return lines;
}

export const diff = defineCommand({
  meta: { name: "diff", description: t(cliDiffDescription) },
  args: {
    "exit-code": { type: "boolean", description: t(cliDiffOptionExitCode) },
    ...jsonOption,
    ...adminOptions,
  },
  async run({ args }) {
    const client = await adminClient(args);
    const pending = ok(await pendingChanges({ client })) as {
      version?: number;
      changes: Change[];
    };
    const { version, changes } = pending;
    if (args.json) printJson(pending);
    else if (changes.length === 0) console.log(t(cliDiffNone));
    else {
      for (const change of changes) {
        for (const line of renderChange(change)) console.log(line);
      }
      console.log(
        t(cliDiffSummary, { count: changes.length, version: version ?? 0 }),
      );
    }
    // Like `git diff --exit-code`: 1 when there is something to publish.
    if (args["exit-code"] && changes.length > 0) process.exitCode = 1;
  },
});
