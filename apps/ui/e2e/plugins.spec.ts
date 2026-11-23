/**
 * add a plugin through its generated form (RJSF from
 * Kong's schema), publish, and see the route tester report that plugin's
 * decision from the live gateway.
 */
import { expect, test } from "./fixtures";

const API = "/api/v1";

test("plugin form → publish → route tester shows the plugin's decision", async ({
  page,
}) => {
  // The page's own request context: the Access header and base URL.
  const { request } = page;
  const api = (path: string) => `${API}${path}`;
  // A service and a route to attach the plugin to.
  const service = await (
    await request.post(api("/services"), {
      data: {
        name: "pw-service",
        host: "api.upstream.test",
        protocol: "https",
      },
    })
  ).json();
  await request.post(api("/routes"), {
    data: { name: "pw-route", service_id: service.id, paths: ["/pw"] },
  });

  // The catalog, filtered by category; each card says what the
  // plugin does. The plugin's form comes from its JSON Schema.
  await page.goto("/ui/plugin-catalog");
  await page.getByRole("button", { name: "Traffic control" }).click();
  await expect(page.getByTestId("plugin-card-key-auth")).toHaveCount(0);
  const card = page.getByTestId("plugin-card-request-termination");
  await expect(card).toContainText("without calling the upstream");
  await card.getByRole("link", { name: "Add" }).click();
  await expect(page).toHaveURL(/\/ui\/plugin-catalog\/request-termination$/);
  // Route scope through the radio group; the decK preview names the route.
  const preview = page.getByTestId("plugin-preview");
  await expect(preview).toContainText("name: request-termination");
  await expect(preview).not.toContainText("route:");
  // Where it applies: radio cards, then the route picker.
  await page.getByRole("radio", { name: /^Route/ }).check();
  const picker = page.getByRole("combobox", { name: "Route", exact: true });
  await picker.selectOption({ label: "pw-route" });
  const routeId = await picker.inputValue();
  await expect(preview).toContainText(`route: ${routeId}`);
  // The layout's fields first, labelled from the catalog.
  await page.getByLabel("Status code").fill("418");
  await page.getByLabel("Message", { exact: true }).fill("teapot");
  await page.getByRole("button", { name: "Stage plugin" }).click();
  await expect(
    page.getByText("Plugin added. Publish to apply it."),
  ).toBeVisible();
  // Back in the catalog, the card says it's staged.
  await page.goto("/ui/plugin-catalog");
  await expect(
    page.getByTestId("plugin-card-request-termination"),
  ).toContainText("Staged");

  // The staged change first; the diff is folded until opened.
  await page.goto("/ui/publish");
  await expect(page.getByTestId("change-group-plugins")).toBeVisible();
  await expect(page.getByText("Staged", { exact: true })).toHaveCount(0);
  await page.getByTestId("publish-diff").locator("summary").click();
  await expect(page.getByText("Staged", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "decK / YAML" }).click();
  // Publishing asks first.
  await page.getByTestId("publish-button").click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Publish", exact: true })
    .click();
  await expect(page.getByText(/Published version \d+/)).toBeVisible();
  await expect(page.getByRole("cell", { name: /live/ })).toBeVisible();
  // Published: the catalog card says the plugin is in use.
  await page.goto("/ui/plugin-catalog");
  await expect(
    page.getByTestId("plugin-card-request-termination"),
  ).toContainText("In use");

  // The route tester: the gateway answers 418 and reports the plugin.
  await page.goto("/ui/tester");
  await page.getByLabel("Path").fill("/pw/anything");
  // The gateway re-reads the live version about once a second.
  await expect(async () => {
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByTestId("tester-trace")).toContainText(
      "request-termination",
      { timeout: 1000 },
    );
  }).toPass({ timeout: 15_000 });
  const result = page.getByTestId("tester-result");
  await expect(result).toContainText("418");
  await expect(result).toContainText("short-circuit");
  await expect(result).toContainText("teapot");
  // the plugin answered: the route is still named, with no upstream bar.
  await expect(page.getByTestId("tester-route")).toContainText(
    "Matched route:",
  );
  await expect(page.getByTestId("tester-upstream")).toHaveCount(0);
});

test("rate-limiting with only Per minute filled", async ({ page }) => {
  await page.goto("/ui/plugin-catalog/rate-limiting");
  // The limits first; Redis and the rest are folded under Advanced.
  await expect(page.getByRole("region", { name: "Limits" })).toContainText(
    "Per second",
  );
  await expect(page.getByTestId("plugin-advanced")).not.toHaveAttribute("open");
  await expect(
    page.getByRole("region", { name: "What callers see" }),
  ).toContainText("EDG-RL-001");
  await page.getByLabel("Per minute").fill("7");
  await expect(page.getByTestId("plugin-preview")).toContainText("minute: 7");
  const created = page.waitForResponse(
    (res) =>
      res.request().method() === "POST" &&
      res.url().endsWith("/api/v1/plugins"),
  );
  await page.getByRole("button", { name: "Stage plugin" }).click();
  const res = await created;
  expect(res.ok()).toBe(true);
  const plugin = (await res.json()) as {
    id: string;
    name: string;
    config: Record<string, unknown>;
  };
  expect(plugin.name).toBe("rate-limiting");
  expect(plugin.config.minute).toBe(7);
  expect(plugin.config.second ?? null).toBeNull();
  // Not left staged for the other specs.
  await page.request.delete(`/api/v1/plugins/${plugin.id}`);
});
