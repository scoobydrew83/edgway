/**
 * a page that can't load shows the admin's error with a
 * retry; a consumer's keys and basic-auth users are managed on its page, a
 * new key shown once in a dialog; publishing asks for confirmation.
 * a rollback's confirmation names the credentials it would revive.
 * the overview's latency, top-consumer and live-config tiles.
 * a publish's warnings stay on screen.
 */
import { HEADER } from "@edgway/constants";
import { expect, test } from "./fixtures";

test("a failed load shows the error, its code and a retry", async ({
  page,
}) => {
  // A real failure: the admin has no schema for an unknown plugin.
  const schemaCalls: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/v1/plugin-schemas/")) {
      schemaCalls.push(request.url());
    }
  });
  await page.goto("/ui/plugin-catalog/not-a-plugin");
  const error = page.getByTestId("error-state");
  await expect(error).toBeVisible();
  const code = /EDG-[A-Z]+-\d{3}/;
  await expect(error).toContainText(code);
  await expect(error.getByRole("link", { name: code })).toHaveAttribute(
    "href",
    /errors\/EDG-[A-Z]+-\d{3}/,
  );
  // Retry asks the admin again (still failing here: it stays an error).
  const before = schemaCalls.length;
  await error.getByRole("button", { name: "Try again" }).click();
  await expect.poll(() => schemaCalls.length).toBeGreaterThan(before);
  await expect(page.getByTestId("error-state")).toBeVisible();
});

test("credentials are managed on the consumer page, a new key in a dialog", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const created = await page.request.post("/api/v1/consumers", {
    data: { username: "e2e-credentials" },
  });
  expect(created.ok()).toBe(true);
  const { id } = (await created.json()) as { id: string };
  await page.goto(`/ui/consumers/${id}/show`);

  // Add a key: shown once, with a copy button.
  const keys = page.getByRole("region", { name: "API keys" });
  await keys.getByRole("button", { name: "Add an API key" }).click();
  const dialog = page.getByTestId("key-dialog");
  await expect(dialog).toBeVisible();
  const key = (await dialog.getByTestId("new-key").textContent()) ?? "";
  expect(key.length).toBeGreaterThan(20);
  await dialog.getByRole("button", { name: "Copy" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(key);
  await dialog.getByRole("button", { name: "I’ve saved it" }).click();
  await expect(dialog).toBeHidden();
  await expect(keys.getByRole("row")).toHaveCount(2);

  // Rotate it (confirmed): a different key.
  await keys.getByRole("button", { name: "Rotate" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Rotate" })
    .click();
  const rotated = page.getByTestId("new-key");
  await expect(rotated).toBeVisible();
  expect(await rotated.textContent()).not.toBe(key);
  await page.getByRole("button", { name: "I’ve saved it" }).click();

  // A basic-auth user, a new password, then delete the key.
  const basic = page.getByRole("region", { name: "Basic auth" });
  await basic.getByRole("button", { name: "Add a basic-auth user" }).click();
  const add = page.getByRole("dialog");
  await add.getByLabel("Username").fill("e2e-basic");
  await add.getByLabel("Password").fill("first-password");
  await add.getByRole("button", { name: "Save" }).click();
  await expect(basic.getByRole("cell", { name: "e2e-basic" })).toBeVisible();
  await basic.getByRole("button", { name: "Change password" }).click();
  const change = page.getByRole("dialog");
  await change.getByLabel("Password").fill("second-password");
  await change.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await keys.getByRole("button", { name: "Delete" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Delete" })
    .click();
  await expect(keys.getByText("None yet.")).toBeVisible();
});

test("publishing shows the changes and asks first", async ({ page }) => {
  const created = await page.request.post("/api/v1/services", {
    data: { name: "e2e-publish", host: "publish.example.test" },
  });
  expect(created.ok()).toBe(true);
  await page.goto("/ui/publish");
  await expect(page.getByTestId("change-group-services")).toContainText(
    "e2e-publish",
  );
  await expect(page.getByTestId("sidebar-unpublished")).toBeVisible();

  // Cancelling publishes nothing.
  await page.getByTestId("publish-button").click();
  const confirm = page.getByRole("dialog");
  await expect(confirm).toContainText(/Publish \d+ changes?\?/);
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByTestId("change-list")).toBeVisible();

  // Confirmed: one publish, and nothing left to publish.
  await page.getByTestId("publish-button").click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Publish", exact: true })
    .click();
  await expect(page.getByTestId("no-changes")).toBeVisible();
  await expect(page.getByTestId("sidebar-unpublished")).toHaveCount(0);
});

test("staged changes show a banner and the Publish count on every page", async ({
  page,
}) => {
  const created = await page.request.post("/api/v1/services", {
    data: { name: "e2e-staged", host: "staged.example.test" },
  });
  expect(created.ok()).toBe(true);
  for (const path of ["/ui/services", "/ui/tester"]) {
    await page.goto(path);
    const banner = page.getByTestId("staged-banner");
    await expect(banner).toContainText(/\d+ unpublished changes?\./);
    await expect(
      banner.getByRole("link", { name: "Review and publish" }),
    ).toHaveAttribute("href", /\/publish$/);
    await expect(page.getByTestId("sidebar-unpublished")).toHaveText(/\d+/);
  }

  // Below 768 px the header keeps a "N to publish" link.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  const link = page.getByTestId("mobile-publish-link");
  await expect(link).toBeVisible();
  await expect(link).toHaveText(/^\d+ to publish$/);

  // Published: the banner, the count and the link are gone.
  const published = await page.request.post("/api/v1/config/publish", {
    data: {},
  });
  expect(published.ok()).toBe(true);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/ui/services");
  await expect(page.getByTestId("staged-banner")).toHaveCount(0);
  await expect(page.getByTestId("sidebar-unpublished")).toHaveCount(0);
  await expect(page.getByTestId("mobile-publish-link")).toHaveCount(0);
});

test("a publish says when an upstream's algorithm runs as round-robin", async ({
  page,
}) => {
  const created = await page.request.post("/api/v1/upstreams", {
    data: { name: "e2e-pool.internal", algorithm: "least-connections" },
  });
  expect(created.ok()).toBe(true);
  await page.goto("/ui/publish");
  await page.getByTestId("publish-button").click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Publish", exact: true })
    .click();
  await expect(
    page.getByText(
      "Upstream e2e-pool.internal uses least-connections, which runs as round-robin on Workers.",
    ),
  ).toBeVisible();
  await expect(page.getByTestId("no-changes")).toBeVisible();
});

test("a rollback names the credentials it would make work again", async ({
  page,
}) => {
  const consumer = (await (
    await page.request.post("/api/v1/consumers", {
      data: { username: "e2e-rollback" },
    })
  ).json()) as { id: string };
  const issued = (await (
    await page.request.post(`/api/v1/consumers/${consumer.id}/key-auth`, {
      data: {},
    })
  ).json()) as { credential: { id: string } };
  const published = await page.request.post("/api/v1/config/publish", {
    data: { note: "e2e-rollback" },
  });
  expect(published.ok()).toBe(true);
  const { version } = (await published.json()) as { version: number };
  // Deleting the key revokes it at once (a new live version).
  const deleted = await page.request.delete(
    `/api/v1/key-auth/${issued.credential.id}`,
  );
  expect(deleted.ok()).toBe(true);

  await page.goto("/ui/publish");
  const row = page.getByRole("row").filter({
    has: page.getByRole("cell", { name: String(version), exact: true }),
  });
  await row.getByRole("button", { name: "Roll back" }).click();
  const confirm = page.getByRole("dialog");
  const warning = confirm.getByTestId("rollback-revived");
  await expect(warning).toContainText("1 credential");
  await expect(warning).toContainText(issued.credential.id);
  // Cancelled: nothing rolls back.
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // A preview that fails says so instead of showing no warning.
  await page.route("**/api/v1/config/rollback", async (route) => {
    const body = route.request().postDataJSON() as { dry_run?: boolean };
    if (body.dry_run) await route.fulfill({ status: 500, body: "{}" });
    else await route.continue();
  });
  await row.getByRole("button", { name: "Roll back" }).click();
  await expect(
    page.getByRole("dialog").getByTestId("rollback-preview-failed"),
  ).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel" })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("an uploaded plugin's edit page falls back to the generic form", async ({
  page,
}) => {
  // No Kong schema for an uploaded plugin: the admin's not-found problem.
  const uploaded = await page.request.post("/api/v1/sandbox_plugins", {
    data: {
      name: "e2e-uploaded",
      version: "1.0.0",
      code: "export function access() { return {}; }",
    },
  });
  expect(uploaded.ok()).toBe(true);
  const created = await page.request.post("/api/v1/plugins", {
    data: { name: "e2e-uploaded", config: {} },
  });
  expect(created.ok()).toBe(true);
  const { id } = (await created.json()) as { id: string };
  const upload = (await uploaded.json()) as { id: string };
  try {
    await page.goto(`/ui/plugins/${id}/edit`);
    await expect(page.getByRole("button", { name: "Save" })).toBeVisible();
    await expect(page.getByTestId("error-state")).toHaveCount(0);
  } finally {
    // Leave the shared state as found, even on failure (the sandbox spec
    // reads the only upload).
    expect((await page.request.delete(`/api/v1/plugins/${id}`)).ok()).toBe(
      true,
    );
    expect(
      (await page.request.delete(`/api/v1/sandbox_plugins/${upload.id}`)).ok(),
    ).toBe(true);
  }
});

test("the overview shows the live config even without analytics", async ({
  page,
}) => {
  await page.goto("/ui/");
  const config = page.getByTestId("overview-config");
  await expect(config).toBeVisible();
  await expect(config).toContainText(/Version \d+|Nothing published yet/);
  await expect(page.getByTestId("overview-empty")).toBeVisible();
});

test("the overview shows p50, p99, the busiest consumers and the last publish", async ({
  page,
}) => {
  await page.route("**/api/v1/analytics/overview*", (route) =>
    route.fulfill({
      json: {
        configured: true,
        hours: 24,
        series: [
          { hour: "2026-10-07 09:00:00", requests: 40, errors: 2, mean_ms: 6 },
        ],
        routes: [{ route: "route-1", requests: 40, errors: 2 }],
        latency: { p50_ms: 3.5, p99_ms: 21.25 },
        consumers: [{ consumer: "consumer-1", requests: 30, errors: 1 }],
        config: {
          live: 7,
          last_publish: {
            version: 7,
            created_at: 1_791_360_000,
            created_by: "publisher@example.com",
          },
        },
      },
    }),
  );
  await page.goto("/ui/");
  await expect(page.getByTestId("overview-p50")).toContainText("3.5 ms");
  await expect(page.getByTestId("overview-p99")).toContainText("21.3 ms");
  const config = page.getByTestId("overview-config");
  await expect(config).toContainText("Version 7");
  await expect(config).toContainText("publisher@example.com");
  const consumers = page.getByTestId("overview-consumers");
  await expect(consumers).toContainText("Busiest consumers");
  await expect(
    consumers.getByRole("row", { name: /consumer-1/ }),
  ).toContainText("30");
});

test("the overview switches its range and shows requests and error rate", async ({
  page,
}) => {
  const asked: string[] = [];
  await page.route("**/api/v1/analytics/overview*", (route) => {
    const hours = Number(
      new URL(route.request().url()).searchParams.get("hours"),
    );
    asked.push(String(hours));
    return route.fulfill({
      json: {
        configured: true,
        hours,
        series: [
          { hour: "2026-10-07 09:00:00", requests: 150, errors: 3, mean_ms: 6 },
          { hour: "2026-10-07 10:00:00", requests: 50, errors: 1, mean_ms: 5 },
        ],
        routes: [],
        latency: { p50_ms: 3, p99_ms: 20 },
        consumers: [],
        config: { live: 1, last_publish: null },
      },
    });
  });
  await page.goto("/ui/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Traffic, last 24 hours",
  );
  await expect(page.getByTestId("overview-requests")).toContainText("200");
  await expect(page.getByTestId("overview-error-rate")).toContainText("2%");
  await expect(page.getByTestId("overview-chart")).toBeVisible();

  await page.getByRole("button", { name: "Last 7 days" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Traffic, last 7 days",
  );
  await expect(
    page.getByRole("button", { name: "Last 7 days" }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Last hour" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Traffic, last hour",
  );
  expect(asked).toEqual(["24", "168", "1"]);
});

test("the tester draws a waterfall and names the matched route", async ({
  page,
}) => {
  await page.route("**/api/v1/tester", (route) =>
    route.fulfill({
      json: {
        status: 200,
        headers: { [HEADER.route]: "route-orders" },
        body: "ok",
        truncated: false,
        durationMs: 20,
        trace: [
          {
            plugin: "key-auth",
            id: "p1",
            phase: "access",
            outcome: "ok",
            durationMs: 2,
          },
          // The gateway's own upstream entry.
          {
            plugin: "upstream",
            id: "svc-orders",
            phase: "upstream",
            outcome: "",
            durationMs: 17,
          },
          {
            plugin: "cors",
            id: "p2",
            phase: "header_filter",
            outcome: "ok",
            durationMs: 1,
          },
        ],
      },
    }),
  );
  await page.goto("/ui/tester");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByTestId("tester-route")).toHaveText(
    "Matched route: route-orders",
  );
  const rows = page.getByTestId("tester-trace").getByRole("row");
  // Header, key-auth, the upstream (its own 17 ms), then cors.
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(1)).toContainText("key-auth");
  await expect(rows.nth(2)).toContainText("Upstream");
  await expect(rows.nth(2)).toContainText("17");
  await expect(rows.nth(3)).toContainText("cors");
});

test("the audit log lists an edit and a publish, newest first, and filters by action", async ({
  page,
}) => {
  const created = await page.request.post("/api/v1/services", {
    data: { name: "e2e-audit", host: "audit.example.test" },
  });
  expect(created.ok()).toBe(true);
  const { id } = (await created.json()) as { id: string };
  const published = await page.request.post("/api/v1/config/publish", {
    data: {},
  });
  expect(published.ok()).toBe(true);
  const { version } = (await published.json()) as { version: number };

  await page.goto("/ui/audit");
  const rows = page.getByTestId("audit-row");
  await expect(rows.nth(0)).toContainText("Published");
  await expect(rows.nth(0)).toContainText(`Version ${version}`);
  await expect(rows.nth(1)).toContainText("Created");
  await expect(rows.nth(1).getByRole("link")).toHaveAttribute(
    "href",
    `/ui/services/${id}/show`,
  );
  // A row expands to its diff.
  await rows.nth(1).getByRole("button", { name: "Details" }).click();
  await expect(page.getByTestId("audit-details")).toContainText(
    "audit.example.test",
  );

  // Filtered to publishes on the server: no create rows left.
  await page.getByLabel("Action").selectOption({ label: "Published" });
  await expect(rows.first()).toContainText("Published");
  await expect(rows.filter({ hasText: "Created" })).toHaveCount(0);
});

test("the audit log names entities and filters by who, action and entity", async ({
  page,
}) => {
  const post = async (path: string, data: object) => {
    const res = await page.request.post(`/api/v1${path}`, { data });
    expect(res.ok()).toBe(true);
    return (await res.json()) as { id: string };
  };
  const service = await post("/services", {
    name: "e2e-audit-svc",
    host: "audit-named.example.test",
  });
  const route = await post("/routes", {
    name: "httpbin-anything",
    paths: ["/audit-anything"],
    service_id: service.id,
  });
  await post("/plugins", {
    name: "rate-limiting",
    route_id: route.id,
    config: { minute: 9 },
  });
  const consumer = await post("/consumers", { username: "e2e-audit-user" });
  await post(`/consumers/${consumer.id}/key-auth`, {});

  await page.goto("/ui/audit");
  const rows = page.getByTestId("audit-row");
  // A nameless credential is named by its consumer, not its id.
  await expect(
    rows.filter({ hasText: "API key on consumer e2e-audit-user" }).first(),
  ).toBeVisible();
  await expect(
    rows.filter({ hasText: "route httpbin-anything" }).first(),
  ).toBeVisible();
  await expect(
    rows
      .filter({ hasText: "plugin rate-limiting on route httpbin-anything" })
      .first(),
  ).toBeVisible();

  // Filtered to routes on the server.
  await page.getByLabel("Entity").selectOption({ label: "route" });
  await expect(rows.first()).toContainText("route ");
  await expect(rows.filter({ hasText: "plugin " })).toHaveCount(0);
  // Someone else: nothing.
  await page.getByLabel("Who").fill("nobody@example.com");
  await page.getByLabel("Who").press("Enter");
  await expect(page.getByTestId("audit-empty")).toBeVisible();
});

test("publishing at scale: changes grouped by entity, removals first, searchable, whose", async ({
  page,
}) => {
  const api = async (method: string, path: string, data?: object) => {
    const res = await page.request.fetch(`/api/v1${path}`, { method, data });
    expect(res.ok()).toBe(true);
    return res.status() === 204 ? {} : ((await res.json()) as { id: string });
  };
  // A clean slate: publish whatever earlier tests staged.
  const old = await api("POST", "/services", {
    name: "e2e-scale-old",
    host: "old.example.test",
  });
  const route = await api("POST", "/routes", {
    name: "e2e-scale-route",
    paths: ["/scale"],
    service_id: (old as { id: string }).id,
  });
  await api("POST", "/config/publish", {});
  // Staged across three entity types.
  await api("DELETE", `/routes/${(route as { id: string }).id}`);
  await api("POST", "/consumers", { username: "e2e-scale-c" });
  await api("PATCH", `/services/${(old as { id: string }).id}`, {
    host: "old2.example.test",
  });
  await api("POST", "/services", {
    name: "e2e-scale-new",
    host: "new.example.test",
  });

  await page.goto("/ui/publish");
  const list = page.getByTestId("change-list");
  await expect(list.getByTestId("change-counts")).toHaveCount(3);
  // The group with a removal comes first.
  await expect(
    list.locator("[data-testid^=change-group-]").first(),
  ).toHaveAttribute("data-testid", "change-group-routes");
  await expect(page.getByTestId("change-group-routes")).toContainText(
    "0 added, 0 changed, 1 removed",
  );
  await expect(page.getByTestId("change-group-consumers")).toContainText(
    "1 added, 0 changed, 0 removed",
  );
  await expect(page.getByTestId("change-group-services")).toContainText(
    "1 added, 1 changed, 0 removed",
  );
  // Whose: every change was staged by this session's identity.
  await expect(page.getByTestId("change-authors")).toContainText(
    "Publishing takes every staged change: 4 by e2e@example.com.",
  );
  // Search by name, then by a route path.
  await page.getByLabel("Search changes").fill("e2e-scale-c");
  await expect(list.locator("[data-testid^=change-group-]")).toHaveCount(1);
  await expect(page.getByTestId("change-group-consumers")).toBeVisible();
  await page.getByLabel("Search changes").fill("/scale");
  await expect(list.locator("[data-testid^=change-group-]")).toHaveCount(1);
  await expect(page.getByTestId("change-group-routes")).toBeVisible();
});
