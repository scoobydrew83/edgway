import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  generateRegistry,
  pluginMessages,
  registrySource,
} from "../src/registry";

describe("registry codegen (c12 + knitwork)", () => {
  it("writes a static registry of the configured plugin packages", async () => {
    const out = path.join(
      await mkdtemp(path.join(tmpdir(), "edgway-registry-")),
      "plugins.gen.ts",
    );
    const packages = await generateRegistry({
      cwd: path.join(import.meta.dirname, "fixtures/registry"),
      outFile: out,
      // No plugin here brings messages.
      load: async (pkg) => ({ name: pkg }),
    });
    expect(packages).toEqual([
      "@edgway/plugin-cors",
      "@edgway/plugin-rate-limiting",
    ]);
    expect(await readFile(out, "utf8")).toBe(registrySource(packages));
  });

  it("re-exports each package's default plugin under a safe name", () => {
    const code = registrySource([
      "@edgway/plugin-rate-limiting",
      "@edgway/plugin-cors",
      "@edgway/plugin-cors",
    ]);
    const lines = code.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(
      /^export \{ default as \w+ \} from "@edgway\/plugin-cors";$/,
    );
    expect(lines[1]).toMatch(
      /^export \{ default as \w+ \} from "@edgway\/plugin-rate-limiting";$/,
    );
  });
});

describe("plugin messages", () => {
  const plugin = {
    name: "acme-auth",
    messages: {
      denied: {
        id: "plugins.acme-auth.denied",
        defaultMessage: "Acme says no, {who}",
      },
    },
  };

  it("merges each plugin's messages into the registry, which adds them to the catalog", async () => {
    const out = path.join(
      await mkdtemp(path.join(tmpdir(), "edgway-registry-")),
      "plugins.gen.ts",
    );
    await generateRegistry({
      cwd: path.join(import.meta.dirname, "fixtures/registry"),
      outFile: out,
      load: async (pkg) =>
        pkg === "@edgway/plugin-cors" ? plugin : { name: "rate-limiting" },
    });
    const code = await readFile(out, "utf8");
    expect(code.startsWith('import { addMessages } from "@edgway/i18n";')).toBe(
      true,
    );
    expect(code).toContain('"plugins.acme-auth.denied": "Acme says no, {who}"');
    // Still only the plugins are exported.
    expect(code.match(/^export /gm)).toHaveLength(2);
  });

  it("leaves the registry as it was when no plugin brings messages", () => {
    expect(registrySource(["@edgway/plugin-cors"], {})).toBe(
      registrySource(["@edgway/plugin-cors"]),
    );
  });

  it("refuses a message id outside the plugin's own namespace", () => {
    for (const id of ["errors.auth.required", "plugins.other.denied", ""]) {
      expect(() =>
        pluginMessages([
          { name: "acme-auth", messages: { m: { id, defaultMessage: "x" } } },
        ]),
      ).toThrow("plugins.acme-auth.");
    }
  });

  it("puts plugin messages under Edgway's own, which win a clash", async () => {
    const { addMessages, t } = await import("@edgway/i18n");
    const { errorsAuthRequired } = await import("@edgway/i18n/messages");
    addMessages({
      "plugins.acme-auth.denied": "Acme says no, {who}",
      [errorsAuthRequired.id as string]: "hijacked",
    });
    expect(
      t({ id: "plugins.acme-auth.denied", defaultMessage: "" }, { who: "Bob" }),
    ).toBe("Acme says no, Bob");
    expect(t(errorsAuthRequired)).not.toBe("hijacked");
  });
});
