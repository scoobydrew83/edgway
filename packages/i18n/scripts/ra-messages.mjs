/**
 * Writes the framework section of src/messages.ts, between
 * its BEGIN/END markers: react-admin's English strings
 * (ra-language-english, polyglot syntax) and react-jsonschema-form's
 * (@rjsf/utils TranslatableString) as FormatJS messages, so the admin UI's
 * framework strings live in the catalog. Run once per upgrade of either
 * (`pnpm --filter @edgway/i18n ra-messages`); the section is then owned
 * as source, like the rest of the catalog.
 *
 * Polyglot `%{name}` becomes `{name}`; `a |||| b` plurals become
 * `{smart_count, plural, one {a} other {b}}`. RJSF's `%1`, `%2` become
 * `{p1}`, `{p2}`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { TranslatableString } from "@rjsf/utils";
import english from "ra-language-english";

/** ICU-escape the characters FormatJS reads as syntax (not placeholders). */
const icuEscape = (text) => text.replace(/'/g, "’").replace(/[{}]/g, "");

function polyglot(text) {
  const forms = text.split("||||").map((form) => form.trim());
  // Placeholders out of the way of the escaping, then back as ICU.
  const icu = (form) =>
    icuEscape(form.replace(/%\{(\w+)\}/g, "⟦$1⟧")).replace(
      /⟦(\w+)⟧/g,
      (_, name) =>
        forms.length > 1 && name === "smart_count" ? "#" : `{${name}}`,
    );
  if (forms.length === 1) return icu(forms[0]);
  // FormatJS wants the count as `#` in the `one` branch too.
  const one = icu(forms[0]).replace(/\b1\b/, "#");
  return `{smart_count, plural, one {${one}} other {${icu(forms[1])}}}`;
}

const rjsf = (text) => icuEscape(text).replace(/%(\d)/g, (_, n) => `{p${n}}`);

function flatten(object, prefix = "") {
  return Object.entries(object).flatMap(([key, value]) =>
    typeof value === "object"
      ? flatten(value, `${prefix}${key}.`)
      : [[`${prefix}${key}`, value]],
  );
}

const camel = (id) =>
  id
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part, i) => (i === 0 ? part : part[0].toUpperCase() + part.slice(1)))
    .join("");

/**
 * Not catalog messages: ra.boolean.null is empty and ra.page.list is just
 * `{name}`. The admin UI's i18nProvider answers them itself.
 */
const SKIPPED = new Set(["ra.boolean.null", "ra.page.list"]);

const entries = [
  ...flatten(english.default ?? english)
    .filter(([key]) => !SKIPPED.has(key))
    .map(([key, text]) => ({
      id: key,
      text: polyglot(text),
      description: `react-admin (ra-core) string: ${key}.`,
    })),
  ...Object.entries(TranslatableString).map(([key, text]) => ({
    id: `rjsf.${key}`,
    text: rjsf(text),
    description: `react-jsonschema-form string: TranslatableString.${key} (placeholders p1, p2).`,
  })),
];

const BEGIN = "// BEGIN framework strings (scripts/ra-messages.mjs)";
const END = "// END framework strings";
const section = `${BEGIN}
// react-admin's (\`ra.*\`) and react-jsonschema-form's (\`rjsf.*\`) strings,
// first written from ra-language-english and @rjsf/utils. Ids are the
// libraries' own keys, so their translate calls find them.
${entries
  .map(
    ({ id, text, description }) => `export const ${camel(id)} = defineMessage({
  id: ${JSON.stringify(id)},
  defaultMessage: ${JSON.stringify(text)},
  description: ${JSON.stringify(description)},
});`,
  )
  .join("\n")}
${END}
`;

const file = new URL("../src/messages.ts", import.meta.url);
const current = readFileSync(file, "utf8");
const start = current.indexOf(BEGIN);
const kept =
  start < 0
    ? `${current.trimEnd()}\n`
    : current.slice(0, start) +
      current.slice(current.indexOf(END) + END.length).replace(/^\n/, "");
writeFileSync(file, `${kept.trimEnd()}\n\n${section}`);
console.log(`${entries.length} messages`);
