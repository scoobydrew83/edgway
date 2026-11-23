import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      miniflare: {
        compatibilityDate: "2025-04-14",
        compatibilityFlags: ["nodejs_compat"],
      },
    }),
  ],
  test: {
    include: ["test/**/*.test.ts"],
    // workerd reports a JS stream's error as unhandled when a native consumer
    // (Response.text(), fetch) reads it, although the consumer handles it.
    // Only the plugin's own oversized-body error is ignored (Drew's decision);
    // test/workerd-stream-error.test.ts reproduces the quirk.
    onUnhandledError: (error) =>
      (error as { name?: string }).name === "BodyTooLarge" ? false : undefined,
  },
});
