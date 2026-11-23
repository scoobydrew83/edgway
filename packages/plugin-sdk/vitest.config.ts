import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        // definePlugin, the test kit and plain middleware run in workerd.
        plugins: [
          cloudflareTest({
            miniflare: {
              compatibilityDate: "2025-04-14",
              compatibilityFlags: ["nodejs_compat"],
            },
          }),
        ],
        test: {
          name: "workers",
          include: ["test/**/*.test.ts"],
          exclude: ["test/registry.test.ts"],
        },
      },
      {
        // The registry codegen is build-time Node (c12 reads the filesystem).
        test: {
          name: "node",
          include: ["test/registry.test.ts"],
          environment: "node",
        },
      },
    ],
  },
});
