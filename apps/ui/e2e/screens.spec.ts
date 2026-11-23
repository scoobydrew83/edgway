/**
 * screenshots of every screen in `docs/design/fidelity-review.md`,
 * for comparing with its mockup (`pnpm --filter @edgway/ui screens`). Seeds
 * a small but full config through the native API, then writes full-page
 * PNGs to `apps/ui/screens/`, with an index naming each one's mockup.
 * `test:e2e` skips this file (playwright.config.ts).
 */
import "reflect-metadata";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { X509CertificateGenerator } from "@peculiar/x509";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

const OUT = path.resolve(import.meta.dirname, "../screens");
const MOCKUPS = "docs/design/mockups";
const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

/** Each screenshot written, and its mockup board. */
const written: { file: string; mockup: string }[] = [];

async function shot(
  page: Page,
  name: string,
  url: string | undefined,
  mockup: string,
) {
  if (url) await page.goto(url);
  await page.waitForLoadState("networkidle");
  const file = `${name}.png`;
  // The whole page in one viewport, so the fixed sidebar is drawn at the
  // page's full height, as on a screen tall enough to show it all.
  const viewport = page.viewportSize() ?? DESKTOP;
  const height = await page.evaluate(
    () => document.documentElement.scrollHeight,
  );
  await page.setViewportSize({
    width: viewport.width,
    height: Math.max(height, viewport.height),
  });
  await page.screenshot({ path: path.join(OUT, file), fullPage: true });
  await page.setViewportSize(viewport);
  written.push({ file, mockup: `${MOCKUPS}/${mockup}` });
}

/** A self-signed certificate that expires in `days`, as PEM. */
async function expiringCert(days: number) {
  const alg = {
    name: "ECDSA",
    namedCurve: "P-256",
    hash: "SHA-256",
  } as const;
  const keys = await crypto.subtle.generateKey(alg, false, ["sign", "verify"]);
  const now = Date.now();
  const cert = await X509CertificateGenerator.createSelfSigned({
    serialNumber: "01",
    name: "CN=api.screens.example.test",
    notBefore: new Date(now - 86_400_000),
    notAfter: new Date(now + days * 86_400_000),
    keys,
    signingAlgorithm: alg,
  });
  return cert.toString("pem");
}

test("screens", async ({ page }) => {
  test.setTimeout(180_000);
  mkdirSync(OUT, { recursive: true });
  const api = async (method: string, url: string, data?: object) => {
    const res = await page.request.fetch(`/api/v1${url}`, { method, data });
    expect(res.ok(), `${method} ${url}: ${await res.text()}`).toBe(true);
    return (await res.json()) as { id: string };
  };

  // The seed: an upstream with two targets and a service on it.
  const pool = await api("POST", "/upstreams", {
    name: "httpbin-pool",
    algorithm: "least-connections",
  });
  await api("POST", "/targets", {
    upstream_id: pool.id,
    target: "httpbin-a.internal:80",
    weight: 70,
  });
  await api("POST", "/targets", {
    upstream_id: pool.id,
    target: "httpbin-b.internal:80",
    weight: 30,
  });
  const service = await api("POST", "/services", {
    name: "httpbin",
    host: "httpbin-pool",
  });
  const routes = [];
  for (const [name, paths, methods] of [
    ["httpbin-anything", ["/anything"], ["GET", "POST"]],
    ["httpbin-status", ["/status"], ["GET"]],
    ["public-ip", ["/ip"], ["GET"]],
  ] as const) {
    routes.push(
      await api("POST", "/routes", {
        name,
        paths,
        methods,
        service_id: service.id,
      }),
    );
  }
  const consumer = await api("POST", "/consumers", { username: "partner-a" });
  await api("POST", `/consumers/${consumer.id}/key-auth`, {});
  await api("POST", "/acls", { consumer_id: consumer.id, group: "partners" });
  await api("POST", "/jwt_secrets", {
    consumer_id: consumer.id,
    key: "partner-issuer",
    algorithm: "HS256",
    secret: "{vault://env/vault-partner-jwt}",
  });
  await api("POST", "/consumer_groups", { name: "partners" });
  await api("POST", "/plugins", {
    name: "key-auth",
    service_id: service.id,
    config: {},
  });
  await api("POST", "/plugins", {
    name: "rate-limiting",
    route_id: routes[0]?.id,
    config: { minute: 60 },
  });
  await api("POST", "/plugins", {
    name: "rate-limiting",
    consumer_id: consumer.id,
    config: { minute: 600 },
  });
  const expiring = await api("POST", "/certificates", {
    cert: await expiringCert(9),
    key: "{vault://env/screens-cert-key}",
  });
  await api("POST", "/snis", {
    name: "api.screens.example.test",
    certificate_id: expiring.id,
  });
  // And one valid for a year.
  await api("POST", "/certificates", {
    cert: await expiringCert(365),
    key: "{vault://env/screens-valid-key}",
  });
  // A vault entity, and a plugin secret kept as plain text, on a
  // route the tester doesn't call.
  await api("POST", "/vaults", {
    name: "env",
    prefix: "payments",
    description: "Payment provider keys",
  });
  await api("POST", "/plugins", {
    name: "openid-connect",
    route_id: routes[2]?.id,
    config: {
      issuer: "https://idp.example/",
      client_id: ["edgway"],
      client_secret: ["plain-text-secret"],
    },
  });
  await api("POST", "/config/publish", {});
  // Two staged changes.
  await api("PATCH", `/routes/${routes[1]?.id}`, { methods: ["GET", "HEAD"] });
  await api("POST", "/consumers", { username: "partner-b" });

  await page.setViewportSize(DESKTOP);
  await shot(page, "overview", "/ui/", "Main.png");
  await shot(page, "publish", "/ui/publish", "Publish.png");
  // The diff, opened: only the changed entities.
  await page.getByTestId("publish-diff").locator("summary").click();
  await page.locator(".monaco-diff-editor").first().waitFor();
  await shot(page, "publish-diff", undefined, "Publish.png");

  // The tester after a send: key-auth refuses a caller with no key.
  await page.goto("/ui/tester");
  await page.getByLabel("Path").fill("/anything");
  // The gateway re-reads the live version about once a second.
  await expect(async () => {
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByTestId("tester-trace")).toContainText("key-auth", {
      timeout: 1000,
    });
  }).toPass({ timeout: 15_000 });
  await shot(page, "tester", undefined, "Tester.png");

  await shot(page, "routes", "/ui/routes", "Routes.png");
  await shot(page, "route-create", "/ui/routes/create", "RouteForm.png");
  // The service form follows the route form's pattern.
  await shot(page, "service-create", "/ui/services/create", "RouteForm.png");
  await shot(page, "service", `/ui/services/${service.id}/show`, "Service.png");
  await shot(page, "upstream", `/ui/upstreams/${pool.id}/show`, "Upstream.png");
  // As a portal developer, as on the board: only the portal's own sign-in
  // makes one, so the consumer's read says so here.
  await page.route(`**/api/v1/consumers/${consumer.id}`, async (route) => {
    const res = await route.fetch();
    const json = await res.json();
    await route.fulfill({
      response: res,
      json: {
        ...json,
        display_name: "dev@partner.example",
        portal: { developer: true, blocked: false },
      },
    });
  });
  await shot(
    page,
    "consumer",
    `/ui/consumers/${consumer.id}/show`,
    "Consumer.png",
  );
  await page.unroute(`**/api/v1/consumers/${consumer.id}`);
  await shot(page, "catalog", "/ui/plugin-catalog", "Catalog.png");
  await shot(
    page,
    "plugin-form",
    "/ui/plugin-catalog/rate-limiting",
    "PluginForm.png",
  );
  // A change expanded inline, as on the board.
  await page.goto("/ui/audit");
  await page
    .getByTestId("audit-row")
    .filter({ hasText: "route httpbin-status" })
    .first()
    .getByRole("button", { name: "Details" })
    .click();
  await shot(page, "audit", undefined, "Audit.png");
  await shot(page, "certificates", "/ui/certificates", "Certificates.png");
  await shot(page, "vaults", "/ui/vaults", "Vaults.png");
  // The upload form with a binding named, as on the board.
  await page.goto("/ui/sandbox_plugins/create");
  const bindings = page.getByTestId("bindings");
  await bindings
    .getByRole("textbox", { name: "Add a binding" })
    .fill("KV_CACHE");
  await bindings.getByRole("button", { name: "Add a binding" }).click();
  await shot(page, "upload", undefined, "Sandbox.png");

  await page.setViewportSize(PHONE);
  await shot(page, "overview-390", "/ui/", "Main.png");
  await shot(page, "route-create-390", "/ui/routes/create", "RouteForm.png");

  writeFileSync(
    path.join(OUT, "index.md"),
    [
      "# Screens and their mockups",
      "",
      "Written by `pnpm --filter @edgway/ui screens`. Each screenshot at 1440 px unless its name says 390.",
      "",
      "| Screenshot | Mockup |",
      "| --- | --- |",
      ...written.map(({ file, mockup }) => `| \`${file}\` | \`${mockup}\` |`),
      "",
    ].join("\n"),
  );
});
