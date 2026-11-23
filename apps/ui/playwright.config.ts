import { defineConfig, devices } from "@playwright/test";

// The real admin Worker (apps/admin, serving dist/ui) is started by
// e2e/global-setup.ts with Cloudflare Access stubbed; the browser sends a
// minted Access assertion. Chromium comes from PLAYWRIGHT_BROWSERS_PATH.
export default defineConfig({
  testDir: "e2e",
  // The screenshot run (`pnpm screens`) isn't a test.
  testIgnore: process.env.E2E_SCREENS ? [] : ["**/screens.spec.ts"],
  timeout: 60_000,
  workers: 1,
  globalSetup: "./e2e/global-setup.ts",
  reporter: [["list"]],
  use: { ...devices["Desktop Chrome"], trace: "retain-on-failure" },
});
