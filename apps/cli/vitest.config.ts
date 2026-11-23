import { defineConfig } from "vitest/config";

// The CLI runs in Node: the tests drive the built dist/index.js against a
// real admin Worker started locally with wrangler's unstable_startWorker.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 240_000,
    hookTimeout: 240_000,
  },
});
