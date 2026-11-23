/**
 * create a service, then a route on it; list, filter by
 * tag, edit and delete, through the UI against the real admin Worker.
 */
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

/**
 * The kit's array input: its label is plain text in the field's group, the
 * innermost group with that label (forms group fields in fieldsets).
 */
const field = (page: Page, label: string) =>
  page
    .getByRole("group")
    .filter({ has: page.getByText(label, { exact: true }) })
    .last();

async function addValue(page: Page, label: string, value: string) {
  const input = field(page, label).getByRole("textbox");
  await input.fill(value);
  await input.press("Enter");
}

const SERVICE = "e2e-service";
const ROUTE = "e2e-route";

test("services and routes: create, list, filter, edit, delete", async ({
  page,
}) => {
  // Create a service.
  await page.goto("/ui/services/create");
  // Basics, then where it sends requests.
  await expect(
    page.getByRole("group", { name: "Where it sends requests" }),
  ).toContainText("Host");
  await page.getByLabel("Name").fill(SERVICE);
  await page.getByLabel("Host").fill("api.example.test");
  // Rare fields are folded under "Advanced".
  await page.getByText("Advanced", { exact: true }).click();
  await addValue(page, "Tags", "e2e");
  await page.getByRole("button", { name: "Stage service" }).click();
  await expect(page).toHaveURL(/\/ui\/services\/[^/]+\/show$/);
  await expect(page.getByText("api.example.test").first()).toBeVisible();
  const serviceUrl = page.url();

  // Create a route on it.
  await page.goto("/ui/routes/create");
  await page.getByLabel("Name").fill(ROUTE);
  await page.getByLabel("Service").click();
  await page.getByRole("option", { name: SERVICE }).click();
  // Paths are chips; one Kong wouldn't take is a field error on staging.
  await addValue(page, "Paths", "e2e");
  await expect(page.getByTestId("form-preview")).toContainText(
    `name: ${ROUTE}`,
  );
  await page.getByRole("button", { name: "Stage route" }).click();
  await expect(field(page, "Paths")).toContainText('A path starts with "/"');
  await expect(page).toHaveURL(/\/ui\/routes\/create$/);
  // Fixed: staged, and the preview shows the path.
  await field(page, "Paths")
    .getByRole("button", { name: /remove|delete|clear/i })
    .first()
    .click();
  await addValue(page, "Paths", "/e2e");
  await expect(page.getByTestId("form-preview")).toContainText("- /e2e");
  // Methods are checkboxes.
  await page.getByRole("checkbox", { name: "GET" }).click();
  await page.getByRole("checkbox", { name: "POST" }).click();
  await expect(page.getByTestId("form-preview")).toContainText("- POST");
  await page.getByRole("button", { name: "Stage route" }).click();
  await expect(page).toHaveURL(/\/ui\/routes\/[^/]+\/show$/);
  const routeUrl = page.url();

  // The service's page lists its route, in "How requests reach it".
  await page.goto(serviceUrl);
  await expect(
    page.getByTestId("service-flow").getByRole("link", { name: /e2e-route/ }),
  ).toBeVisible();

  // List, then search, then filter by tag, which is secondary,
  // behind "Add filter".
  await page.goto("/ui/services");
  await expect(page.getByRole("cell", { name: SERVICE })).toBeVisible();
  const search = page.getByRole("textbox", {
    name: "Filter this page",
  });
  await search.fill("no-such-service");
  await expect(page.getByRole("cell", { name: SERVICE })).toHaveCount(0);
  await search.fill(SERVICE);
  await expect(page.getByRole("cell", { name: SERVICE })).toBeVisible();
  await search.fill("");
  await page.getByRole("button", { name: "Add filter" }).click();
  await page.getByRole("menuitemcheckbox", { name: /Tags/ }).click();
  const tags = page.getByLabel(/^Tags/);
  await tags.fill("e2e");
  await expect(page.getByRole("cell", { name: SERVICE })).toBeVisible();
  await tags.fill("not-a-tag");
  await expect(page.getByRole("cell", { name: SERVICE })).toHaveCount(0);

  // Edit the service's host, once its record has loaded: a value filled
  // before then is replaced by the record's.
  await page.goto(serviceUrl.replace(/\/show$/, ""));
  await expect(page.getByLabel("Name")).toHaveValue(SERVICE);
  await page.getByLabel("Host").fill("api2.example.test");
  // Saved before leaving the page: the PATCH, then the service page.
  const patched = page.waitForResponse(
    (res) => res.request().method() === "PATCH",
  );
  await page.getByRole("button", { name: "Stage service" }).click();
  expect((await patched).ok()).toBe(true);
  await page.goto(serviceUrl);
  await expect(page.getByText("api2.example.test").first()).toBeVisible();

  // Delete the route, then the service.
  for (const [url, name] of [
    [routeUrl, ROUTE],
    [serviceUrl, SERVICE],
  ] as const) {
    await page.goto(url.replace(/\/show$/, ""));
    // Delete needs the loaded record (ra-core deletes the record in context).
    await expect(page.getByLabel("Name")).toHaveValue(name);
    // Delete is undoable: it's sent when the undo toast closes.
    const deleted = page.waitForResponse(
      (res) => res.request().method() === "DELETE",
      { timeout: 15_000 },
    );
    await page.getByRole("button", { name: "Delete" }).click();
    // The list puts its kept filter, sort and page into the query string.
    await page.waitForURL(/\/ui\/(routes|services)(\?|$)/);
    expect((await deleted).ok()).toBe(true);
  }
  // Without the tag filter kept from above, which would hide it anyway.
  await page.goto("/ui/services?filter=%7B%7D");
  await expect(page.getByRole("cell", { name: SERVICE })).toHaveCount(0);
});

test("a service's page shows its upstream's targets and their share", async ({
  page,
}) => {
  const post = async (path: string, data: object) => {
    const res = await page.request.post(`/api/v1${path}`, { data });
    expect(res.ok()).toBe(true);
    return (await res.json()) as { id: string };
  };
  const pool = await post("/upstreams", { name: "e2e-flow.internal" });
  await post("/targets", {
    upstream_id: pool.id,
    target: "a.test:80",
    weight: 25,
  });
  await post("/targets", {
    upstream_id: pool.id,
    target: "b.test:80",
    weight: 75,
  });
  const service = await post("/services", {
    name: "e2e-flow",
    host: "e2e-flow.internal",
  });
  await page.goto(`/ui/services/${service.id}/show`);
  // The flow's upstream box names each target and its weight.
  const upstream = page.getByTestId("service-upstream");
  await expect(upstream).toContainText("Upstream e2e-flow.internal");
  await expect(upstream).toContainText("a.test:80");
  await expect(upstream).toContainText("weight 25");
  // The upstream page has each target's share; a target opens its own
  // page, and an editor can delete one there.
  await page.goto(`/ui/upstreams/${pool.id}/show`);
  const targets = page.getByTestId("upstream-targets");
  await expect(targets.getByRole("row", { name: /a\.test:80/ })).toContainText(
    "25%",
  );
  await expect(targets.getByRole("row", { name: /b\.test:80/ })).toContainText(
    "75%",
  );
  await expect(
    targets.getByRole("link", { name: "a.test:80" }),
  ).toHaveAttribute("href", /\/ui\/targets\/[^/]+\/show$/);
  await targets
    .getByRole("row", { name: /a\.test:80/ })
    .getByRole("button", { name: "Delete" })
    .click();
  await expect(targets.getByRole("row", { name: /a\.test:80/ })).toHaveCount(0);
  await expect(targets.getByRole("row", { name: /b\.test:80/ })).toContainText(
    "100%",
  );

  // A service whose host isn't an upstream calls it directly.
  const direct = await post("/services", {
    name: "e2e-direct",
    host: "direct.example.test",
  });
  await page.goto(`/ui/services/${direct.id}/show`);
  await expect(page.getByTestId("service-direct")).toContainText(
    "Calls direct.example.test directly.",
  );

  // A failed lookup isn't "directly": the error, with a retry.
  let failures = 1;
  await page.route("**/api/v1/upstreams/direct.example.test", (route) =>
    failures-- > 0
      ? route.fulfill({ status: 500, json: { title: "Internal error" } })
      : route.fallback(),
  );
  await page.reload();
  await expect(page.getByTestId("error-state")).toBeVisible();
  await expect(page.getByTestId("service-direct")).toHaveCount(0);
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByTestId("service-direct")).toContainText(
    "Calls direct.example.test directly.",
  );
});

test("an upstream's page says its algorithm runs as round-robin, with health settings", async ({
  page,
}) => {
  const res = await page.request.post("/api/v1/upstreams", {
    data: { name: "e2e-lc.internal", algorithm: "least-connections" },
  });
  expect(res.ok()).toBe(true);
  const { id } = (await res.json()) as { id: string };
  await page.goto(`/ui/upstreams/${id}/show`);
  await expect(page.getByTestId("upstream-fallback")).toContainText(
    "least-connections runs as round-robin on Workers",
  );
  const health = page.getByTestId("upstream-health");
  await expect(health).toContainText("Passive");
  await expect(health).toContainText("Active");
  await expect(health).toContainText("no live health");
});

test("a service's page says which plugins run for a route and caller", async ({
  page,
}) => {
  const post = async (path: string, data: object) => {
    const r = await page.request.post(`/api/v1${path}`, { data });
    expect(r.ok()).toBe(true);
    return (await r.json()) as { id: string };
  };
  const service = await post("/services", {
    name: "e2e-which",
    host: "which.test",
  });
  const route = await post("/routes", {
    name: "e2e-which-route",
    paths: ["/which"],
    service_id: service.id,
  });
  const consumer = await post("/consumers", { username: "e2e-which-user" });
  const limit = {
    name: "rate-limiting",
    config: { minute: 10, policy: "local" },
  };
  await post("/plugins", { ...limit, route_id: route.id });
  await post("/plugins", { ...limit, consumer_id: consumer.id });

  await page.goto(`/ui/services/${service.id}/show`);
  const panel = page.getByTestId("which-plugins");
  // A table: one row per instance, in run order.
  const items = panel.getByTestId("which-list").locator("tbody tr");
  // Nobody signed in: the route's instance runs.
  await expect(items).toHaveCount(1);
  await expect(items.first()).toContainText("Route");
  // As the consumer: its instance runs, the route's is struck through.
  await panel
    .getByLabel("Caller")
    .selectOption({ label: "Consumer e2e-which-user" });
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toHaveAttribute("data-runs", "true");
  await expect(items.nth(0)).toContainText("Consumer");
  await expect(items.nth(1)).toHaveAttribute("data-runs", "false");
  await expect(items.nth(1)).toContainText("replaced by a more specific one");
});

test("the service, upstream and consumer pages are their own layouts", async ({
  page,
}) => {
  const post = async (path: string, data: object) => {
    const r = await page.request.post(`/api/v1${path}`, { data });
    expect(r.ok()).toBe(true);
    return (await r.json()) as { id: string };
  };
  const pool = await post("/upstreams", { name: "e2e-pages.internal" });
  const service = await post("/services", {
    name: "e2e-pages",
    host: "e2e-pages.internal",
  });
  await post("/routes", {
    name: "e2e-pages-route",
    paths: ["/pages"],
    service_id: service.id,
  });

  // The service: the flow above "Which plugins run", and no field list.
  await page.goto(`/ui/services/${service.id}/show`);
  const flow = page.getByTestId("service-flow");
  await expect(flow).toContainText("How requests reach it");
  await expect(flow).toContainText("e2e-pages-route");
  await expect(flow.getByTestId("service-upstream")).toContainText(
    "e2e-pages.internal",
  );
  const flowBox = await flow.boundingBox();
  const whichBox = await page.getByTestId("which-plugins").boundingBox();
  expect(flowBox && whichBox && flowBox.y < whichBox.y).toBe(true);
  await expect(page.getByText("Hash on header")).toHaveCount(0);
  await expect(page.getByText("Tls verify", { exact: false })).toHaveCount(0);

  // The upstream: settings in brief, health in words, a target staged inline.
  await page.goto(`/ui/upstreams/${pool.id}/show`);
  await expect(page.getByTestId("upstream-settings")).toContainText(
    "From the target",
  );
  await expect(page.getByTestId("upstream-health")).not.toContainText("{");
  await page.getByLabel("New target").fill("e2e-inline.test:80");
  await page.getByRole("button", { name: "Stage target" }).click();
  await expect(
    page
      .getByTestId("upstream-targets")
      .getByRole("row", { name: /e2e-inline\.test:80/ }),
  ).toContainText("100%");
  await expect(page.getByText("Hash on header")).toHaveCount(0);

  // The consumer: a portal developer's badges and Block portal access.
  const consumer = await post("/consumers", { username: "e2e-pages-dev" });
  await page.route(`**/api/v1/consumers/${consumer.id}`, async (route) => {
    const res = await route.fetch();
    await route.fulfill({
      response: res,
      json: {
        ...(await res.json()),
        portal: { developer: true, blocked: false },
      },
    });
  });
  await page.goto(`/ui/consumers/${consumer.id}/show`);
  await expect(page.getByTestId("portal-badges")).toContainText(
    "Portal developer",
  );
  await expect(page.getByTestId("portal-badges")).toContainText(
    "Portal access allowed",
  );
  await expect(
    page.getByRole("button", { name: "Block portal access" }),
  ).toBeVisible();
  // Empty details are left out.
  await expect(page.getByTestId("consumer-details")).not.toContainText(
    "Custom ID",
  );
});
