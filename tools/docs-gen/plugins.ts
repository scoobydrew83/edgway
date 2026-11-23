/**
 * The plugin reference (PRD "Docs site"): one page per plugin from the Kong
 * JSON Schema @edgway/schema vendors, listing every `config` field with its
 * type, default and description.
 */
import { existsSync, readFileSync } from "node:fs";
import { type JSONSchema, jsonSchema, PLUGIN_NAMES } from "@edgway/schema";
import { code, frontmatter, GENERATED, text } from "./mdx";

/** The repository root (docs-gen runs from apps/docs). */
const REPO = "../..";

/** The repository's GitHub URL, from the root package.json. */
const repositoryUrl = (): string =>
  (
    JSON.parse(readFileSync(`${REPO}/package.json`, "utf8")) as {
      repository: { url: string };
    }
  ).repository.url.replace(/\.git$/, "");

/**
 * A plugin package's summary: its README's opening sentence (each README
 * starts with "Kong's <name> plugin (priority N) for Edgway").
 */
function summary(name: string): string {
  const file = `${REPO}/plugins/${name}/README.md`;
  if (!existsSync(file)) return "";
  const paragraph =
    readFileSync(file, "utf8")
      .split(/\n\s*\n/)
      .find((block) => block.trim() && !block.startsWith("#")) ?? "";
  return paragraph.split(/(?<=\.)\s/)[0]?.trim() ?? "";
}

/** The plugins index: every plugin, its summary and its package. */
function index(names: string[]): string {
  const repo = repositoryUrl();
  return [
    frontmatter({
      title: "Plugins",
      description: "Every plugin Edgway ships, with its configuration page.",
    }),
    GENERATED,
    "Each plugin takes Kong's configuration unchanged. Its page lists every field from Kong's schema, and its package README lists what Edgway doesn't support. Plugins run in Kong's priority order.",
    "",
    ...names.map((name) => {
      const readme = `${repo}/blob/main/plugins/${name}/README.md`;
      const about = summary(name);
      return `- [${name}](/plugins/${name})${about ? `: ${about}` : ""} ([README](${readme}))`;
    }),
    "",
  ].join("\n");
}

type Schema = Exclude<JSONSchema, boolean>;

/**
 * Credit for Kong's field descriptions, from the record of the
 * schemas @edgway/schema copies (its third-party/ directory).
 */
function credit(): string {
  const meta = JSON.parse(
    readFileSync(
      `${REPO}/packages/schema/third-party/kong-developer.konghq.com/third-party.json`,
      "utf8",
    ),
  ) as { name: string; license: string; homepage: string };
  return `The field descriptions are Kong's, from [${meta.name}](${meta.homepage}) (Copyright (c) Kong Inc., ${meta.license} License).`;
}

/** A field's type, as Kong's schema states it. */
function typeOf(schema: Schema): string {
  if (schema.enum)
    return schema.enum.map((v) => code(JSON.stringify(v))).join(", ");
  const type = Array.isArray(schema.type)
    ? schema.type.join(" or ")
    : schema.type;
  if (
    type === "array" &&
    schema.items &&
    typeof schema.items === "object" &&
    !Array.isArray(schema.items)
  ) {
    return `array of ${typeOf(schema.items as Schema)}`;
  }
  if (schema.anyOf || schema.oneOf) {
    return ((schema.anyOf ?? schema.oneOf) as Schema[])
      .map(typeOf)
      .join(" or ");
  }
  return type ?? "any";
}

/** Rows for an object's properties; nested objects use dotted names. */
function rows(schema: Schema, prefix = ""): string[] {
  const required = new Set(schema.required ?? []);
  return Object.entries(schema.properties ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([key, value]) => {
      const field = value as Schema;
      const name = `${prefix}${key}`;
      const row = `| ${code(name)} | ${typeOf(field)} | ${required.has(key) ? "yes" : ""} | ${
        field.default === undefined ? "" : code(JSON.stringify(field.default))
      } | ${text(field.description)} |`;
      return field.type === "object" && field.properties
        ? [row, ...rows(field, `${name}.`)]
        : [row];
    });
}

export function pluginPages(): Record<string, string> {
  const names = [...PLUGIN_NAMES].sort();
  const files: Record<string, string> = {};
  for (const name of names) {
    const schema = jsonSchema(name) as Schema;
    const config = (schema.properties?.config ?? {}) as Schema;
    files[`${name}.mdx`] = [
      frontmatter({
        title: name,
        description: `Configuration of the ${name} plugin (Kong 3.9 schema).`,
      }),
      GENERATED,
      `Edgway accepts Kong's \`${name}\` configuration unchanged: the schema below is Kong's own. The plugin package's [README](${repositoryUrl()}/blob/main/plugins/${name}/README.md) lists what Edgway doesn't support.`,
      "",
      "| Field | Type | Required | Default | Description |",
      "| --- | --- | --- | --- | --- |",
      ...rows(config, "config."),
      "",
      credit(),
      "",
    ].join("\n");
  }
  files["index.mdx"] = index(names);
  files["meta.json"] =
    `${JSON.stringify({ title: "Plugins", pages: ["index", ...names] }, null, 2)}\n`;
  return files;
}
