/**
 * the portal's landing page and API reference
 * are public; a developer signs in, creates named keys, copies one (the
 * full key, shown once), and after a reload only its prefix is described,
 * never handed over as the secret; rolling one key replaces it alone.
 * signing in never claims the username the IdP's name suggests.
 */
import { API_KEY, HEADER, MEDIA_TYPE } from "@edgway/constants";
import { expect, type Page, test } from "@playwright/test";

const portal = () => process.env.E2E_PORTAL_URL ?? "";
const gateway = () => process.env.E2E_GATEWAY_URL ?? "";

/** Whether the gateway serves the test route with `key` (within a version check). */
async function works(key: string) {
  const res = await fetch(`${gateway()}/pw/items?apikey=${key}`);
  return res.ok && (await res.json()).upstream === true;
}

/** A key's entry: one child of Zudoku's key list (each key is its own entry). */
const entry = (page: Page, name: string) =>
  page
    .getByRole("list")
    .filter({ has: page.getByRole("button", { name: "Roll key" }) })
    .locator(":scope > *")
    .filter({ hasText: name });

async function create(page: Page, name: string) {
  await page.getByRole("button", { name: "Create API Key" }).first().click();
  await page.getByRole("dialog").getByRole("textbox").first().fill(name);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /create|generate|submit/i })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

/** The key under an entry, copied with its copy button. */
async function copy(page: Page, name: string) {
  await page.evaluate(() => navigator.clipboard.writeText("(nothing)"));
  await entry(page, name)
    .getByRole("button", { name: "Copy to clipboard" })
    .click();
  return page.evaluate(() => navigator.clipboard.readText());
}

test("the landing page and API reference need no sign-in", async ({ page }) => {
  await page.goto(`${portal()}/`);
  await expect(
    page.getByRole("link", { name: "Manage your API keys" }),
  ).toBeVisible();
  // How to get going: three steps and a first request against the
  // gateway the build named.
  const steps = page.getByTestId("get-going");
  await expect(steps.getByRole("listitem")).toHaveCount(3);
  await expect(steps).toContainText("1. Sign in");
  await expect(steps).toContainText("2. Create a key");
  await expect(steps).toContainText("3. Make a request");
  await expect(page.getByTestId("first-request")).toContainText(
    'curl -H "apikey: $API_KEY" https://api.example.test/',
  );
  await page.getByRole("link", { name: "Read the API reference" }).click();
  await expect(page).toHaveURL(/\/reference/);
  await expect(
    page.getByRole("button", { name: /log ?in|sign ?in/i }).first(),
  ).toBeVisible();
});

test("create → copy → reload → roll one key", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  // Without a key, the gateway refuses the route.
  expect((await fetch(`${gateway()}/pw/items`)).ok).toBe(false);

  await page.goto(`${portal()}/settings/api-keys`);
  // The mock IdP signs the developer in without a form.
  await page
    .getByRole("button", { name: /log ?in|sign ?in/i })
    .first()
    .click();
  // What rolling does is said above the list.
  await expect(page.getByTestId("key-help")).toContainText(
    "replaces that key alone",
  );

  await create(page, "laptop");
  await create(page, "ci server");
  const laptop = await copy(page, "laptop");
  const ci = await copy(page, "ci server");
  for (const key of [laptop, ci]) {
    expect(key).toMatch(new RegExp(`^${API_KEY.prefix}\\S{20,}$`));
  }
  await expect(async () => {
    expect(await works(laptop)).toBe(true);
    expect(await works(ci)).toBe(true);
  }).toPass({ timeout: 15_000 });

  // After a reload the full keys are gone: the prefix is described, and
  // copying never yields it (or any key).
  await page.reload();
  const prefix = laptop.slice(0, API_KEY.displayPrefixLength);
  await expect(entry(page, "laptop")).toContainText(`Starts with ${prefix}`);
  const after = await copy(page, "laptop");
  expect(after).not.toContain(prefix);
  expect(after).toBe("");

  // Roll the laptop key: a new full key, shown again; the old one stops
  // working, the CI key keeps working.
  await entry(page, "laptop")
    .getByRole("button", { name: /roll key/i })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Roll Key" })
    .click();
  await expect(entry(page, "laptop")).not.toContainText("Starts with");
  const rolled = await copy(page, "laptop");
  expect(rolled).toMatch(new RegExp(`^${API_KEY.prefix}\\S{20,}$`));
  expect(rolled).not.toBe(laptop);
  await expect(async () => {
    expect(await works(rolled)).toBe(true);
    expect(await works(laptop)).toBe(false);
    expect(await works(ci)).toBe(true);
  }).toPass({ timeout: 15_000 });
});

test("a developer's IdP name never becomes a consumer username", async () => {
  // Runs after the sign-in above: the developer has a consumer.
  const admin = async (pathname: string, init: RequestInit = {}) =>
    fetch(`${process.env.E2E_ADMIN_URL}/api/v1${pathname}`, {
      ...init,
      headers: {
        [HEADER.cfAccessJwtAssertion]: process.env.E2E_ADMIN_ASSERTION ?? "",
        [HEADER.contentType]: MEDIA_TYPE.json,
      },
    });
  type Consumer = { id: string; username?: string; display_name?: string };
  const { data } = (await (await admin("/consumers")).json()) as {
    data: Consumer[];
  };
  const developer = data.find((c) => c.display_name);
  expect(developer?.display_name).toBe("pw-developer@example.com");
  expect(developer?.username ?? null).toBeNull();
  // The operator's own "acme-partner" (the IdP's name for the developer) is
  // free, and a different consumer.
  const created = await admin("/consumers", {
    method: "POST",
    body: JSON.stringify({ username: "acme-partner" }),
  });
  expect(created.ok).toBe(true);
  expect(((await created.json()) as Consumer).id).not.toBe(developer?.id);
});
