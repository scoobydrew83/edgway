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
  test: { include: ["test/**/*.test.ts"] },
});
