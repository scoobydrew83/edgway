/**
 * a certificate's key is a vault reference only, and the
 * list reads each certificate's subject and expiry, flagging one that's
 * expiring; the vaults page builds references and lists plain-text secrets;
 * an upload over the sandbox's CPU limit is refused.
 */
import { readFileSync } from "node:fs";
import { expect, test } from "./fixtures";

const pem = (name: string) =>
  readFileSync(new URL(`./${name}`, import.meta.url), "utf8");

test("a certificate takes its key as a vault reference only", async ({
  page,
}) => {
  await page.goto("/ui/certificates/create");
  await page
    .getByLabel(/^Certificate \(PEM\)\W*$/)
    .fill(pem("fixture-cert.pem"));
  const key = page.getByLabel(/^Private key\W*$/);
  await key.fill("-----BEGIN PRIVATE KEY-----");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Must be a vault reference")).toBeVisible();
  await expect(page).toHaveURL(/\/ui\/certificates\/create$/);
  // The hint says why.
  await expect(
    page.getByText("Edgway never stores a private key").first(),
  ).toBeVisible();

  await key.fill("{vault://env/vault-cert-key}");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL(/\/ui\/certificates\/[^/]+\/show$/);
});

test("the certificate list reads subjects and expiry, and flags an expiring one", async ({
  page,
}) => {
  const res = await page.request.post("/api/v1/certificates", {
    data: {
      cert: pem("fixture-expiring-cert.pem"),
      key: "{vault://env/vault-expiring-key}",
    },
  });
  expect(res.ok()).toBe(true);
  await page.goto("/ui/certificates");
  await expect(page.getByTestId("cert-banner")).toContainText(
    "expired or expire",
  );
  const row = page.getByRole("row", { name: /expiring\.e2e\.example\.test/ });
  await expect(row).toContainText("CN=expiring.e2e.example.test");
  await expect(row.locator("[data-expiry]")).not.toHaveAttribute(
    "data-expiry",
    "ok",
  );
});

test("the certificate page adds one inline, its key a vault reference", async ({
  page,
}) => {
  await page.goto("/ui/certificates");
  const form = page.getByRole("region", { name: "Add certificate" });
  await form.getByLabel(/^Certificate \(PEM\)/).fill(pem("fixture-cert.pem"));
  // The PEM is read as it's pasted.
  await expect(form.getByTestId("cert-read")).toContainText("expires");
  const key = form.getByLabel("Private key (vault reference)");
  await key.fill("-----BEGIN PRIVATE KEY-----");
  await expect(
    form.getByRole("button", { name: "Stage certificate" }),
  ).toBeDisabled();
  await key.fill("{vault://env/vault-inline-key}");
  await form.getByRole("button", { name: "Stage certificate" }).click();
  // Listed with its subject, issuer, key type and expiry.
  const list = page.getByTestId("certificate-list");
  await expect(list).toContainText("Issuer");
  await expect(list.locator("[data-expiry]").first()).toBeVisible();
});

test("the vaults page builds a reference and lists plain-text secrets", async ({
  page,
}) => {
  await page.request.post("/api/v1/plugins", {
    data: {
      name: "openid-connect",
      config: {
        issuer: "https://idp.example/",
        client_secret: ["e2e-raw-secret"],
      },
    },
  });
  await page.goto("/ui/vaults");
  const guide = page.getByTestId("vault-guide");
  await expect(guide).toContainText("{vault://env/vault-jwt-key}");
  await guide.getByLabel("Secret name").fill("VAULT_ORDERS_TOKEN");
  await expect(guide.getByTestId("vault-reference")).toHaveText(
    "{vault://env/vault-orders-token}",
  );
  await guide
    .getByLabel("Vault", { exact: true })
    .selectOption("cf-secrets-store");
  await expect(guide.getByTestId("vault-reference")).toHaveText(
    "{vault://cf-secrets-store/VAULT_ORDERS_TOKEN}",
  );
  await guide.getByLabel("Secret name").fill("ORDERS_TOKEN");
  await expect(guide).toContainText("The name must start with VAULT_.");
  // A warning card row per plugin: its name and the raw fields.
  const raw = guide.getByTestId("vault-raw");
  await expect(raw).toContainText("Secrets kept as plain text");
  await expect(raw).toContainText("openid-connect");
  await expect(raw).toContainText("field client_secret");
  await expect(guide).not.toContainText("e2e-raw-secret");
});

test("the upload form's limits stop at the sandbox's (sliders)", async ({
  page,
}) => {
  await page.goto("/ui/sandbox_plugins/create");
  await expect(page.getByTestId("sandbox-limits")).toContainText(
    "no network access",
  );
  await expect(page.getByTestId("sandbox-limits")).toContainText("500 ms");
  // Sliders from 1 to the maximum, showing the default and the most.
  const cpu = page.getByLabel("CPU time (ms)");
  await expect(cpu).toHaveAttribute("type", "range");
  await expect(cpu).toHaveAttribute("min", "1");
  await expect(cpu).toHaveAttribute("max", "500");
  await expect(cpu).toHaveValue("50");
  const sub = page.getByLabel("Subrequests");
  await expect(sub).toHaveAttribute("max", "50");
  await expect(page.getByText("Most 500 ms")).toBeVisible();
  await expect(page.getByText("Default 10", { exact: true })).toBeVisible();
  // Bindings are named, then checkboxes.
  const bindings = page.getByTestId("bindings");
  await bindings
    .getByRole("textbox", { name: "Add a binding" })
    .fill("KV_CACHE");
  await bindings.getByRole("button", { name: "Add a binding" }).click();
  const kv = bindings.getByRole("checkbox", { name: "KV_CACHE" });
  await expect(kv).toBeChecked();
  await expect(bindings).toContainText("only if the gateway allows it");
  await kv.click();
  await expect(kv).not.toBeChecked();
});
