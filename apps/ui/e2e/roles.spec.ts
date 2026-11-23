/**
 * the console knows the signed-in role. A viewer sees
 * Publish and Roll back disabled, with the reason; a publisher can use them.
 */
import { HEADER } from "@edgway/constants";
import { expect, test } from "./fixtures";

/** Two published versions and a staged change, made as the publisher. */
/**
 * Names unique per run, so a retried beforeAll doesn't collide; the service
 * is opened by id, since a long list pages it out of sight.
 */
const run = Date.now().toString(36);
let serviceId = "";

test.beforeAll(async ({ playwright }) => {
  const api = await playwright.request.newContext({
    baseURL: process.env.E2E_BASE_URL,
    extraHTTPHeaders: {
      [HEADER.cfAccessJwtAssertion]: process.env.E2E_TOKEN ?? "",
    },
  });
  for (const name of [`e2e-roles-a-${run}`, `e2e-roles-b-${run}`]) {
    const created = await api.post("/api/v1/services", {
      data: { name, host: `${name}.example.test` },
    });
    expect(created.ok()).toBe(true);
    serviceId ||= ((await created.json()) as { id: string }).id;
    expect((await api.post("/api/v1/config/publish", { data: {} })).ok()).toBe(
      true,
    );
  }
  expect(
    (
      await api.post("/api/v1/services", {
        data: { name: `e2e-roles-staged-${run}`, host: "staged.example.test" },
      })
    ).ok(),
  ).toBe(true);
  await api.dispose();
});

test.describe("as a viewer", () => {
  test.use({
    extraHTTPHeaders: {
      [HEADER.cfAccessJwtAssertion]: process.env.E2E_VIEWER_TOKEN ?? "",
    },
  });

  test("Publish and Roll back are disabled, with the reason", async ({
    page,
  }) => {
    await page.goto("/ui/publish");
    await expect(page.getByTestId("identity")).toContainText(
      "e2e-viewer@example.com",
    );
    await expect(page.getByTestId("identity")).toContainText("Viewer");
    await expect(page.getByTestId("change-list")).toBeVisible();
    await expect(page.getByTestId("publish-button")).toBeDisabled();
    await expect(page.getByTestId("publish-reason")).toHaveText(
      "You're a viewer: you can see changes and history. A publisher or owner can publish and roll back.",
    );
    const rollbacks = page.getByRole("button", { name: "Roll back" });
    await expect(rollbacks.first()).toBeVisible();
    for (const button of await rollbacks.all()) {
      await expect(button).toBeDisabled();
    }
    // Staging is an editor's: no create button, and the notice says why.
    await expect(page.getByTestId("role-notice")).toContainText(
      "An editor, publisher or owner can stage changes.",
    );
    await page.goto("/ui/services");
    await expect(page.getByTestId("role-notice")).toBeVisible();
    await expect(page.getByRole("link", { name: "Create" })).toHaveCount(0);
    // No row selection, so no bulk delete.
    await expect(page.getByRole("row").nth(1)).toBeVisible();
    await expect(page.getByRole("checkbox")).toHaveCount(0);
    // A service's page offers no "Add route".
    await page.goto(`/ui/services/${serviceId}/show`);
    await expect(page.getByRole("link", { name: /^Add / })).toHaveCount(0);
    // The route tester can't send.
    await page.goto("/ui/tester");
    await expect(page.getByRole("button", { name: "Send" })).toBeDisabled();
  });
});

test("as a publisher, Publish and Roll back are enabled", async ({ page }) => {
  await page.goto("/ui/publish");
  await expect(page.getByTestId("identity")).toContainText("Publisher");
  await expect(page.getByTestId("change-list")).toBeVisible();
  await expect(page.getByTestId("publish-button")).toBeEnabled();
  await expect(page.getByTestId("publish-reason")).toHaveCount(0);
  await expect(page.getByTestId("role-notice")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Roll back" }).first(),
  ).toBeEnabled();
  // The same Create link, row selection and "Add" link the viewer doesn't get.
  await page.goto("/ui/services");
  await expect(page.getByRole("link", { name: "Create" })).toBeVisible();
  await expect(page.getByRole("checkbox").first()).toBeVisible();
  await page.goto(`/ui/services/${serviceId}/show`);
  await expect(page.getByRole("link", { name: /^Add / }).first()).toBeVisible();
  await page.goto("/ui/tester");
  await expect(page.getByRole("button", { name: "Send" })).toBeEnabled();
});
