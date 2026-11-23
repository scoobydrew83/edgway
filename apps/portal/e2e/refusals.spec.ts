/**
 * each refusal the portal's key API gives reads as what
 * happened and what to do, and never names the allowed email domains.
 */

import { PORTAL } from "@edgway/constants";
import { ERR } from "@edgway/errors";
import { expect, type Page, test } from "@playwright/test";

const portal = () => process.env.E2E_PORTAL_URL ?? "";

/** The key list answers with `problem` (the admin's refusal). */
async function refusedWith(page: Page, status: number, problem: object) {
  await page.route("**/api/keys", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ status, json: problem })
      : route.fallback(),
  );
  await page.goto(`${portal()}/settings/api-keys`);
  await page
    .getByRole("button", { name: /log ?in|sign ?in/i })
    .first()
    .click();
}

for (const [detail, text] of [
  [PORTAL.blockedDetail, "An admin has turned off your API keys."],
  [
    PORTAL.notAllowedDetail,
    "This portal is for developers at approved organizations.",
  ],
  [
    PORTAL.unverifiedDetail,
    "Your sign-in provider hasn't verified your email address.",
  ],
] as const) {
  test(`a ${detail} refusal says what happened and what to do`, async ({
    page,
  }) => {
    await refusedWith(page, ERR.ADMIN_FORBIDDEN.status, {
      code: ERR.ADMIN_FORBIDDEN.code,
      title: "You aren't allowed to do this",
      detail,
    });
    await expect(page.getByTestId("key-refusal")).toContainText(text);
    // Never the raw detail.
    await expect(page.getByText(detail, { exact: true })).toHaveCount(0);
  });
}

test("the key limit says how many and what to do", async ({ page }) => {
  await page.route("**/api/keys", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({
          status: ERR.ADMIN_KEY_LIMIT.status,
          json: { code: ERR.ADMIN_KEY_LIMIT.code, title: "Too many keys" },
        })
      : route.fallback(),
  );
  await page.goto(`${portal()}/settings/api-keys`);
  await page
    .getByRole("button", { name: /log ?in|sign ?in/i })
    .first()
    .click();
  await expect(page.getByTestId("key-help")).toBeVisible();
  await page.getByRole("button", { name: "Create API Key" }).first().click();
  await page
    .getByRole("dialog")
    .getByRole("textbox")
    .first()
    .fill("one too many");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /create|generate|submit/i })
    .click();
  await expect(page.getByTestId("key-refusal")).toContainText(
    `You already have ${PORTAL.maxKeysPerConsumer} API keys, the most you can hold.`,
  );
});
