import { defineConfig, devices } from "@playwright/test";

// e2e/global-setup.ts starts a mock OIDC provider, the gateway, the admin
// (to seed a key-auth route) and the portal Worker on shared local state.
// Chromium comes from PLAYWRIGHT_BROWSERS_PATH.
export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  workers: 1,
  globalSetup: "./e2e/global-setup.ts",
  reporter: [["list"]],
  use: { ...devices["Desktop Chrome"], trace: "retain-on-failure" },
});
