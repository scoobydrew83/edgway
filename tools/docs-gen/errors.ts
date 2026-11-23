/**
 * The error-code reference (PRD "Docs site"): one page per code at
 * `@edgway/errors`' `docsPath` (`/errors/{code}`), plus an index table. The
 * title is the message's English default, as `t()` renders it.
 */
import { docsPath, type EdgwayError, ERR, problemType } from "@edgway/errors";
import { frontmatter, GENERATED, text } from "./mdx";

const byCode = Object.entries(ERR as Record<string, EdgwayError>).sort(
  ([, a], [, b]) => a.code.localeCompare(b.code),
);

export function errorPages(): Record<string, string> {
  const files: Record<string, string> = {};
  const rows = byCode.map(
    ([name, e]) =>
      `| [\`${e.code}\`](${docsPath(e)}) | ${e.status} | \`${name}\` | ${text(e.message.defaultMessage)} |`,
  );
  files["index.mdx"] = [
    frontmatter({
      title: "Error codes",
      description:
        "Every problem+json error Edgway returns: its code, HTTP status and title.",
    }),
    GENERATED,
    "Errors are RFC 9457 `application/problem+json` bodies. `type` is `urn:edgway:problem:<code>` and `code` repeats the code.",
    "",
    "| Code | Status | Name | Title |",
    "| --- | --- | --- | --- |",
    ...rows,
    "",
  ].join("\n");
  for (const [name, e] of byCode) {
    files[`${e.code}.mdx`] = [
      frontmatter({
        title: e.code,
        description: String(e.message.defaultMessage),
      }),
      GENERATED,
      `- **HTTP status:** ${e.status}`,
      `- **Problem type:** \`${problemType(e)}\``,
      `- **Registry name:** \`ERR.${name}\``,
      `- **Title:** ${text(e.message.defaultMessage)}`,
      e.message.description ? `- **When:** ${text(e.message.description)}` : "",
      "",
      "```json",
      JSON.stringify(
        {
          type: problemType(e),
          status: e.status,
          title: e.message.defaultMessage,
          code: e.code,
        },
        null,
        2,
      ),
      "```",
      "",
    ]
      .filter((line, i, all) => line !== "" || all[i - 1] !== "")
      .join("\n");
  }
  files["meta.json"] = `${JSON.stringify(
    {
      title: "Error codes",
      pages: ["index", ...byCode.map(([, e]) => e.code)],
    },
    null,
    2,
  )}\n`;
  return files;
}
