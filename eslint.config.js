// `i18n` gate, lint half (CLAUDE.md §2: user-facing strings live in the
// @edgway/i18n catalog). Biome does formatting and general linting; ESLint runs
// only the i18n plugins: eslint-plugin-formatjs (message hygiene, no JSX
// literals) and eslint-plugin-i18next (no prose literals in .ts).
import formatjs from "eslint-plugin-formatjs";
import i18next from "eslint-plugin-i18next";
import tseslint from "typescript-eslint";

const source = ["{apps,packages,plugins}/*/src/**/*.{ts,tsx}"];

export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/generated/**",
      // Next's build output.
      "**/.next/**",
      "**/next-env.d.ts",
      // Vendored shadcn/ui and shadcn-admin-kit components.
      "packages/ui-kit/src/**",
      "**/*.test.ts",
      "tools/gates/fixtures/**",
    ],
  },
  {
    files: source,
    languageOptions: { parser: tseslint.parser },
    plugins: { formatjs },
    rules: {
      ...formatjs.configs.recommended.rules,
      "formatjs/no-literal-string-in-jsx": "error",
    },
  },
  {
    // Prose (multi-word strings) outside the catalog. Technical strings
    // (identifiers, units, URNs, header names) have no whitespace.
    files: source,
    ignores: ["packages/constants/**", "packages/i18n/src/messages.ts"],
    languageOptions: { parser: tseslint.parser },
    plugins: { i18next },
    rules: {
      "i18next/no-literal-string": [
        "error",
        {
          mode: "all",
          "should-validate-template": true,
          words: { exclude: ["^\\S+$"] },
          // The default ([A-Z_-]+, case-insensitive) skips every property value.
          "object-properties": { exclude: [] },
        },
      ],
    },
  },
];
