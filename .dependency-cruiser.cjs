/**
 * `boundaries` gate (CLAUDE.md §2). Run: pnpm gate:boundaries
 * Workspace packages resolve through their package.json `exports`, so a deep
 * import past `exports` is unresolvable and fails `no-unresolvable`.
 */
/** Packages a plugin may depend on: the SDK, core, and the shared-value homes. */
const PLUGIN_ALLOWED =
  "(plugin-sdk|core|constants|errors|i18n|telemetry|schema)";

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-import-from-apps",
      comment: "Nothing imports an app, including another app.",
      severity: "error",
      from: { path: "^(apps/[^/]+)/" },
      to: { path: "^apps/[^/]+/", pathNot: "^$1/" },
    },
    {
      name: "no-import-into-apps-from-outside",
      comment: "packages/* and plugins/* never import an app.",
      severity: "error",
      from: { path: "^(packages|plugins)/" },
      to: { path: "^apps/" },
    },
    {
      name: "no-relative-cross-package",
      comment:
        "Import other workspace packages by name through their exports, never by relative path.",
      severity: "error",
      from: { path: "^((?:apps|packages|plugins)/[^/]+)/" },
      to: {
        path: "^(?:packages|plugins)/[^/]+/",
        pathNot: "^$1/",
        dependencyTypes: ["local"],
      },
    },
    {
      name: "plugins-only-via-sdk",
      comment: `Plugins depend only on @edgway/${PLUGIN_ALLOWED}; never on other plugins, adapters or apps.`,
      severity: "error",
      from: { path: "^(plugins/[^/]+)/" },
      to: {
        path: "^(?:packages|plugins)/[^/]+/",
        pathNot: [`^packages/${PLUGIN_ALLOWED}/`, "^$1/"],
      },
    },
    {
      name: "no-unresolvable",
      comment: "Includes deep imports past a workspace package's exports.",
      severity: "error",
      from: {},
      to: { couldNotResolve: true, pathNot: "^cloudflare:" },
    },
    {
      name: "no-circular",
      severity: "error",
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: {
      // Generated code (src/generated) is never edited; Next's
      // build output (.next, next-env.d.ts) is not source.
      path: "(^|/)(node_modules|dist|\\.wrangler|\\.turbo|\\.next)/|(^|/)next-env\\.d\\.ts$|(^|/)src/generated/|^(tools|docs|loops|\\.claude|\\.changeset)/",
    },
    tsPreCompilationDeps: true,
    combinedDependencies: true,
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "types", "default"],
      extensions: [".ts", ".tsx", ".mts", ".js", ".mjs", ".json"],
      mainFields: ["module", "main", "types"],
    },
  },
};
