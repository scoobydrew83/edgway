/** Scaffold templates, inlined as text by esbuild (scripts/build.mjs). */
declare module "*.tmpl" {
  const text: string;
  export default text;
}

/** The package's version, set by scripts/build.mjs (esbuild `define`). */
declare const __EDGWAY_VERSION__: string;
