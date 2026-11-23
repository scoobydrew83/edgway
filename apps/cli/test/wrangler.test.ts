/**
 * The environment `edgway deploy` gives wrangler, and the admin
 * config it deploys.
 */
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { CLI } from "@edgway/constants";
import { describe, expect, it } from "vitest";
import { experimental_readRawConfig } from "wrangler";
import { adminWithoutServices } from "../../../tools/wrangler-config.mjs";
import { wranglerEnv } from "../src/wrangler";

const repo = path.resolve(import.meta.dirname, "../../..");

describe("wranglerEnv", () => {
  it("drops Workers Builds' name override and tag check, keeps the rest", () => {
    const env = {
      [CLI.env.workersBuildsName]: "edgway",
      [CLI.env.workersBuildsTag]: "0123abcd",
      CLOUDFLARE_API_TOKEN: "token",
      CLOUDFLARE_ACCOUNT_ID: "account",
      PATH: "/usr/bin",
    };
    expect(wranglerEnv(env)).toEqual({
      CLOUDFLARE_API_TOKEN: "token",
      CLOUDFLARE_ACCOUNT_ID: "account",
      PATH: "/usr/bin",
    });
    expect(env[CLI.env.workersBuildsName]).toBe("edgway");
  });

  it("passes an environment without them through unchanged", () => {
    expect(wranglerEnv({ PATH: "/usr/bin" })).toEqual({ PATH: "/usr/bin" });
  });
});

describe("the admin's Access settings", () => {
  // Set on the deployed Worker; every deploy, the bootstrap one included,
  // must keep them rather than reset them from the config.
  const access = ["ACCESS_TEAM", "ACCESS_AUD", "ADMIN_ROLES"];

  it("aren't in the admin config, which keeps dashboard-set vars", () => {
    const { rawConfig } = experimental_readRawConfig({
      config: path.join(repo, CLI.adminConfig),
    });
    expect(rawConfig.keep_vars).toBe(true);
    for (const name of access)
      expect(rawConfig.vars ?? {}).not.toHaveProperty(name);
  });

  // The copy local runs and the e2e setups start (tools/wrangler-config.mjs).
  // The first deploy writes its own copy, `{ ...raw, services: [] }` in
  // src/deploy.ts, which keeps every top-level field the same way.
  it("stay kept by the derived admin copy without GATEWAY", () => {
    const file = adminWithoutServices({
      readRawConfig: experimental_readRawConfig,
      config: path.join(repo, CLI.adminConfig),
      file: path.join(
        mkdtempSync(path.join(tmpdir(), "edgway-")),
        CLI.bootstrapConfig,
      ),
    });
    const copy = JSON.parse(readFileSync(file, "utf8"));
    expect(copy.keep_vars).toBe(true);
    expect(copy.services).toBeUndefined();
  });
});
