/**
 * the shell and the shared fixes. The sidebar is the design's (no
 * Targets, the identity pinned, the console pages only there), titles are
 * singular or the entity's name, arrays are badges, and the routes list has
 * a search box, service and method filters and a Plugins column.
 */
import { expect, test } from "./fixtures";

test("the sidebar holds the console pages, no Targets, and who's signed in", async ({
  page,
}) => {
  await page.goto("/ui/routes");
  const sidebar = page.locator("[data-sidebar=sidebar]");
  for (const name of ["Overview", "Publish", "Audit log", "Routes", "Vaults"]) {
    await expect(
      sidebar.getByRole("link", { name, exact: true }),
    ).toBeVisible();
  }
  await expect(sidebar.getByRole("link", { name: "Targets" })).toHaveCount(0);
  await expect(sidebar.getByRole("button", { name: /Jump to/ })).toBeVisible();
  await expect(page.getByTestId("identity")).toContainText(
    "Signed in with Cloudflare Access",
  );
  // The header doesn't repeat them.
  const header = page.locator("main header");
  await expect(header.getByRole("link", { name: "Audit log" })).toHaveCount(0);
  await expect(
    header.getByRole("link", { name: "Plugin catalog" }),
  ).toHaveCount(0);
});

test("titles are singular or the entity's own name", async ({ page }) => {
  const res = await page.request.post("/api/v1/services", {
    data: { name: "e2e-titled", host: "titled.example.test" },
  });
  const { id } = (await res.json()) as { id: string };
  await page.goto("/ui/routes/create");
  await expect(
    page.getByRole("heading", { name: "Create route" }),
  ).toBeVisible();
  await page.goto("/ui/sandbox_plugins/create");
  await expect(
    page.getByRole("heading", { name: "Upload a plugin" }),
  ).toBeVisible();
  await page.goto(`/ui/services/${id}/show`);
  await expect(
    page.getByRole("heading", { name: "e2e-titled", exact: true }),
  ).toBeVisible();
  await page.goto(`/ui/services/${id}`);
  await expect(
    page.getByRole("heading", { name: "Edit e2e-titled" }),
  ).toBeVisible();
});

test("the routes list: badges, search, service and method filters, plugins", async ({
  page,
}) => {
  const post = async (path: string, data: object) =>
    (await (await page.request.post(`/api/v1${path}`, { data })).json()) as {
      id: string;
    };
  const a = await post("/services", { name: "e2e-list-a", host: "a.test" });
  const b = await post("/services", { name: "e2e-list-b", host: "b.test" });
  const route = await post("/routes", {
    name: "e2e-list-one",
    paths: ["/list-one"],
    methods: ["GET", "POST"],
    service_id: a.id,
  });
  await post("/routes", {
    name: "e2e-list-two",
    paths: ["/list-two"],
    service_id: b.id,
  });
  await post("/plugins", {
    name: "rate-limiting",
    route_id: route.id,
    config: { minute: 5 },
  });

  await page.goto("/ui/routes");
  const one = page.getByRole("row", { name: /e2e-list-one/ });
  const two = page.getByRole("row", { name: /e2e-list-two/ });
  // Methods as separate badges; none is "ANY"; no hosts is "Any host".
  await expect(one.getByText("GET", { exact: true })).toBeVisible();
  await expect(one.getByText("POST", { exact: true })).toBeVisible();
  await expect(two.getByText("ANY", { exact: true })).toBeVisible();
  await expect(two).toContainText("Any host");
  await expect(one).toContainText("rate-limiting");

  await page
    .getByRole("textbox", { name: "Filter by name, path or host" })
    .fill("list-two");
  await expect(two).toBeVisible();
  await expect(one).toHaveCount(0);
  await page
    .getByRole("textbox", { name: "Filter by name, path or host" })
    .fill("");

  await page
    .getByRole("group", { name: "Method: any" })
    .getByRole("combobox")
    .click();
  await page.getByRole("option", { name: "POST" }).click();
  await expect(one).toBeVisible();
  await expect(two).toHaveCount(0);
});
