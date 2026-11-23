/**
 * the API keys page shows the developer's own
 * usage per day when the portal can read Analytics Engine, and never lets
 * the panel stand in the way of the keys: not configured, or failing, it is
 * simply absent.
 */
import { expect, type Page, test } from "@playwright/test";

const portal = () => process.env.E2E_PORTAL_URL ?? "";

async function signIn(page: Page) {
  await page.goto(`${portal()}/settings/api-keys`);
  // The mock IdP signs the developer in without a form.
  await page
    .getByRole("button", { name: /log ?in|sign ?in/i })
    .first()
    .click();
  await expect(page.getByTestId("key-help")).toBeVisible();
}

test("shows the developer's requests and server errors per day", async ({
  page,
}) => {
  await page.route("**/api/usage", (route) =>
    route.fulfill({
      json: {
        configured: true,
        days: 7,
        daily: [
          { day: "2026-10-06 00:00:00", requests: 1234, errors: 5 },
          { day: "2026-10-07 00:00:00", requests: 56, errors: 0 },
        ],
      },
    }),
  );
  await signIn(page);
  const panel = page.getByTestId("usage-panel");
  await expect(panel).toContainText("Your usage, last 7 days");
  // A bar chart: two series, a bar per day and series (a day with
  // no errors draws no error bar).
  const chart = panel.getByTestId("usage-chart");
  await expect(chart).toBeVisible();
  await expect(chart.locator(".recharts-bar")).toHaveCount(2);
  await expect(chart.locator(".recharts-bar-rectangle")).toHaveCount(3);
  // The numbers sit behind "Show as a table".
  const table = panel.getByTestId("usage-table");
  await expect(table).toBeHidden();
  await panel.getByText("Show as a table").click();
  await expect(table).toBeVisible();
  await expect(table.getByRole("row")).toHaveCount(3);
  await expect(table.getByRole("row").nth(1)).toContainText("1,234");
  await expect(table.getByRole("row").nth(1)).toContainText("5");
});

test("is hidden without Analytics Engine access, and the keys still work", async ({
  page,
}) => {
  // The test portal has no CF_ACCOUNT_ID: the real endpoint says so.
  await signIn(page);
  await expect(
    page.getByRole("button", { name: "Create API Key" }).first(),
  ).toBeVisible();
  await expect(page.getByTestId("usage-panel")).toHaveCount(0);
});

test("is hidden when the usage request fails", async ({ page }) => {
  await page.route("**/api/usage", (route) =>
    route.fulfill({ status: 500, json: {} }),
  );
  await signIn(page);
  await expect(
    page.getByRole("button", { name: "Create API Key" }).first(),
  ).toBeVisible();
  await expect(page.getByTestId("usage-panel")).toHaveCount(0);
});
