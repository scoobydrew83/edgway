/**
 * The `edgway` CLI (citty): init, deploy, import-deck, diff, publish,
 * versions, rollback and plugin new. Bundled into dist/index.js by
 * scripts/build.mjs, which sets the version.
 *
 * A failing command prints its message only; `--debug` prints the stack
 *. Usage errors and `--help`/`--version` are citty's.
 */
import {
  cliDescription,
  cliErrorDebugHint,
  cliOptionDebug,
  t,
} from "@edgway/i18n";
import { type ArgsDef, type CommandDef, defineCommand, runMain } from "citty";
import { deploy } from "./commands/deploy";
import { diff } from "./commands/diff";
import { importDeck } from "./commands/import-deck";
import { init } from "./commands/init";
import { plugin } from "./commands/plugin";
import { publish } from "./commands/publish";
import { rollback } from "./commands/rollback";
import { versions } from "./commands/versions";

const DEBUG = "--debug";
const debug = process.argv.includes(DEBUG);

function report(error: unknown): void {
  if (debug) console.error(error);
  else {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(t(cliErrorDebugHint));
  }
  process.exitCode = 1;
}

/** The command with its `run` (and its subcommands') reporting errors. */
function guarded<A extends ArgsDef>(command: CommandDef<A>): CommandDef<A> {
  const { run } = command;
  const subCommands = command.subCommands as
    | Record<string, CommandDef<ArgsDef>>
    | undefined;
  return {
    ...command,
    run:
      run &&
      (async (context) => {
        try {
          return await run(context);
        } catch (error) {
          report(error);
        }
      }),
    subCommands:
      subCommands &&
      Object.fromEntries(
        Object.entries(subCommands).map(([name, sub]) => [name, guarded(sub)]),
      ),
  };
}

const main = defineCommand({
  meta: {
    name: "edgway",
    version: __EDGWAY_VERSION__,
    description: t(cliDescription),
  },
  args: { debug: { type: "boolean", description: t(cliOptionDebug) } },
  subCommands: {
    init: guarded(init),
    deploy: guarded(deploy),
    "import-deck": guarded(importDeck),
    diff: guarded(diff),
    publish: guarded(publish),
    versions: guarded(versions),
    rollback: guarded(rollback),
    plugin: guarded(plugin),
  },
});

await runMain(main);
