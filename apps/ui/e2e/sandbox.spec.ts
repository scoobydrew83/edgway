/**
 * write a plugin in the Monaco editor, attach it to a route, publish,
 * and see the live gateway run it in a Dynamic Worker (the route tester).
 */
import { expect, test } from "./fixtures";

const API = "/api/v1";

/** The uploaded plugin: it answers 418 with its config's message. */
const CODE = [
  "export async function access(request, config) {",
  "return { response: new Response(config.message, { status: 418 }) };",
  "}",
].join("\n");

test("plugin editor → attach → publish → the gateway runs it sandboxed", async ({
  page,
  context,
}) => {
  const { request } = page;
  const api = (path: string) => `${API}${path}`;
  const service = await (
    await request.post(api("/services"), {
      data: {
        name: "sb-service",
        host: "api.upstream.test",
        protocol: "https",
      },
    })
  ).json();
  const route = await (
    await request.post(api("/routes"), {
      data: { name: "sb-route", service_id: service.id, paths: ["/sb"] },
    })
  ).json();

  // The editor: name and version, then the code in Monaco.
  await page.goto("/ui/sandbox_plugins/create");
  await page.getByLabel("Name").fill("teapot-guard");
  await page.getByLabel("Version").fill("1.0.0");
  // The code: no file here, so in the editor behind "View source".
  await page.getByRole("button", { name: "View source" }).click();
  const editor = page.getByLabel("Plugin code").locator(".monaco-editor");
  await expect(editor).toBeVisible();
  // Pasted, as an author would (typing gets Monaco's auto-closed brackets).
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.evaluate((code) => navigator.clipboard.writeText(code), CODE);
  await editor.click();
  await page.keyboard.press("ControlOrMeta+V");
  await page.getByRole("button", { name: "Stage plugin" }).click();
  await expect(page).toHaveURL(/\/ui\/sandbox_plugins\/[^/]+\/show$/);
  await expect(page.getByText("teapot-guard").first()).toBeVisible();

  // The code was saved as pasted (line ends aside). Found by name: another
  // spec's upload may be there too.
  const saved = (
    (await (await request.get(api("/sandbox_plugins"))).json()).data as {
      name: string;
      code: string;
    }[]
  ).find((p) => p.name === "teapot-guard");
  const lines = (code = "") => code.split(/\r?\n/).map((l) => l.trimEnd());
  expect(lines(saved?.code)).toEqual(lines(CODE));

  // An instance on the route, then publish.
  await request.post(api("/plugins"), {
    data: {
      name: "teapot-guard",
      route_id: route.id,
      config: { message: "sandboxed teapot" },
    },
  });
  expect((await request.post(api("/config/publish"))).ok()).toBe(true);

  await page.goto("/ui/tester");
  await page.getByLabel("Path").fill("/sb/anything");
  await expect(async () => {
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByTestId("tester-trace")).toContainText(
      "teapot-guard",
      { timeout: 1000 },
    );
  }).toPass({ timeout: 15_000 });
  const result = page.getByTestId("tester-result");
  await expect(result).toContainText("418");
  await expect(result).toContainText("short-circuit");
});
