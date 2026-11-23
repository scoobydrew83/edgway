/**
 * `edgway plugin new <name>`: scaffolds a workspace plugin package (a
 * definePlugin module, its test on the plugin-sdk test kit, a README and the
 * package configs) under `plugins/<name>`.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CLI } from "@edgway/constants";
import {
  cliPluginDescription,
  cliPluginNewDescription,
  cliPluginNewDone,
  cliPluginNewExists,
  cliPluginNewInvalidName,
  cliPluginNewOptionDir,
  cliPluginNewOptionName,
  t,
} from "@edgway/i18n";
import { defineCommand } from "citty";
import index from "../../templates/plugin/index.ts.tmpl";
import pkg from "../../templates/plugin/package.json.tmpl";
import test from "../../templates/plugin/plugin.test.ts.tmpl";
import readme from "../../templates/plugin/README.md.tmpl";
import tsconfig from "../../templates/plugin/tsconfig.json.tmpl";
import vitest from "../../templates/plugin/vitest.config.ts.tmpl";
import { cwdArg, cwdOption } from "../args";

/** Kong-style plugin names: lowercase words joined by dashes. */
const NAME = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

function scaffold(name: string): Record<string, string> {
  const fill = (template: string) =>
    template
      .replaceAll("__PACKAGE__", `@edgway/plugin-${name}`)
      .replaceAll("__SDK_VERSION__", "workspace:*")
      .replaceAll("__NAME__", name);
  return {
    "package.json": fill(pkg),
    "src/index.ts": fill(index),
    [`test/${name}.test.ts`]: fill(test),
    "README.md": fill(readme),
    "tsconfig.json": fill(tsconfig),
    "vitest.config.ts": fill(vitest),
  };
}

const create = defineCommand({
  meta: { name: "new", description: t(cliPluginNewDescription) },
  args: {
    name: {
      type: "positional",
      required: true,
      description: t(cliPluginNewOptionName),
    },
    dir: { type: "string", description: t(cliPluginNewOptionDir) },
    ...cwdOption,
  },
  run({ args }) {
    if (!NAME.test(args.name)) throw new Error(t(cliPluginNewInvalidName));
    const cwd = cwdArg(args);
    const dir = path.resolve(
      cwd,
      args.dir ?? path.join(CLI.pluginDir, args.name),
    );
    if (existsSync(dir)) throw new Error(t(cliPluginNewExists, { dir }));
    for (const [file, content] of Object.entries(scaffold(args.name))) {
      mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
      writeFileSync(path.join(dir, file), content);
    }
    console.log(t(cliPluginNewDone, { dir: path.relative(cwd, dir) || dir }));
  },
});

export const plugin = defineCommand({
  meta: { name: "plugin", description: t(cliPluginDescription) },
  subCommands: { new: create },
});
