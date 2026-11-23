/**
 * `edgway plugin new` → the plugin is
 * added to the registry the admin and the gateway are generated from →
 * publish a route using it → the gateway runs it; a plugin the registry
 * doesn't list is refused.
 *
 * The scaffold lives in a gitignored folder under apps/admin (whose tests
 * include only test/**), so its `@edgway/plugin-sdk` and `zod` resolve
 * through the admin's dependencies;
 * each Worker runs from a gitignored copy of its src whose registry includes
 * it. Everything temporary is removed afterwards (the gates scan the repo).
 */
import { execFile, spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { promisify } from "node:util";
import { CLI, HEADER, MEDIA_TYPE } from "@edgway/constants";
import { ERR } from "@edgway/errors";
import { registrySource } from "@edgway/plugin-sdk/registry";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { experimental_readRawConfig, unstable_startWorker } from "wrangler";
import { derivedConfig } from "../../../tools/wrangler-config.mjs";

const run = promisify(execFile);
const repo = path.resolve(import.meta.dirname, "../../..");
const bin = path.join(import.meta.dirname, "../dist/index.js");
const adminApp = path.join(repo, "apps/admin");
const gatewayApp = path.join(repo, "apps/gateway");

const NAME = "demo-header";
const scaffoldRoot = path.join(adminApp, ".e2e-plugins");
const scaffold = path.join(scaffoldRoot, NAME);
const adminCopy = path.join(adminApp, ".e2e-registry");
const gatewayCopy = path.join(gatewayApp, ".e2e-registry");
const state = path.join(adminCopy, "state");

const TEAM = "edgway-plugin-e2e";
const AUD = "edgway-plugin-e2e-aud";
const EMAIL = "plugins@example.com";

type Worker = Awaited<ReturnType<typeof unstable_startWorker>>;
let admin: Worker | undefined;
let gateway: Worker | undefined;
let post: (pathname: string, body: unknown) => Promise<Response>;
let gatewayUrl: string;

/** A copy of an app's src whose registry adds the scaffolded plugin. */
function withPlugin(app: string, copy: string): string {
  cpSync(path.join(app, "src"), path.join(copy, "src"), { recursive: true });
  const { plugins } = JSON.parse(
    readFileSync(path.join(repo, "edgway.config.json"), "utf8"),
  ) as { plugins: string[] };
  writeFileSync(
    path.join(copy, "src/generated/plugins.ts"),
    registrySource([...plugins, path.join(scaffold, "src/index.ts")]),
  );
  return path.join(copy, "src/index.ts");
}

beforeAll(async () => {
  for (const dir of [scaffoldRoot, adminCopy, gatewayCopy]) {
    rmSync(dir, { recursive: true, force: true });
  }
  mkdirSync(state, { recursive: true });

  // 1. Scaffold, with the CLI as a developer would.
  const created = await run(process.execPath, [
    bin,
    "plugin",
    "new",
    NAME,
    "--dir",
    scaffold,
  ]);
  expect(created.stdout).toContain(NAME);

  // 2. Migrations on the shared local state.
  const adminConfig = path.join(repo, CLI.adminConfig);
  const wrangler = path.join(
    path.dirname(
      createRequire(import.meta.url).resolve("wrangler/package.json"),
    ),
    "bin/wrangler.js",
  );
  const migrate = spawnSync(
    process.execPath,
    [
      wrangler,
      "d1",
      "migrations",
      "apply",
      CLI.adminDatabaseBinding,
      "--local",
      "--persist-to",
      state,
      "--config",
      adminConfig,
    ],
    { cwd: adminApp, stdio: "ignore" },
  );
  expect(migrate.status).toBe(0);

  // 3. Both Workers with a registry that includes the plugin.
  const signing = await generateKeyPair("EdDSA", { extractable: true });
  const access = await generateKeyPair("RS256", { extractable: true });
  const accessJwk = {
    ...(await exportJWK(access.publicKey)),
    kid: "test",
    alg: "RS256",
    use: "sig",
  };
  const dev = {
    persist: state,
    server: { hostname: "127.0.0.1", port: 0 },
    inspector: false,
    watch: false,
    logLevel: "none",
  } as const;
  admin = await unstable_startWorker({
    config: derivedConfig({
      readRawConfig: experimental_readRawConfig,
      config: adminConfig,
      file: path.join(adminCopy, "admin.wrangler.json"),
      edit: () => ({
        main: withPlugin(adminApp, adminCopy),
        build: undefined,
        assets: undefined,
        services: undefined,
      }),
    }),
    bindings: {
      ACCESS_TEAM: { type: "plain_text", value: TEAM },
      ACCESS_AUD: { type: "plain_text", value: AUD },
      ADMIN_ROLES: {
        type: "plain_text",
        value: JSON.stringify({ [EMAIL]: "publisher" }),
      },
      CONFIG_SIGNING_KEY: {
        type: "plain_text",
        value: JSON.stringify(await exportJWK(signing.privateKey)),
      },
    },
    dev: {
      ...dev,
      outboundService: async (request: Request) =>
        new URL(request.url).hostname === `${TEAM}.cloudflareaccess.com`
          ? Response.json({ keys: [accessJwk] })
          : Response.error(),
    },
  });
  // Without Workers AI (remote-only) and the admin's reader binding: it
  // reads KV's pointer here.
  gateway = await unstable_startWorker({
    config: derivedConfig({
      readRawConfig: experimental_readRawConfig,
      config: path.join(repo, CLI.gatewayConfig),
      file: path.join(gatewayCopy, "gateway.wrangler.json"),
      edit: () => ({
        main: withPlugin(gatewayApp, gatewayCopy),
        ai: undefined,
        services: undefined,
      }),
    }),
    bindings: {
      CONFIG_PUBLIC_KEY: {
        type: "plain_text",
        value: JSON.stringify(await exportJWK(signing.publicKey)),
      },
    },
    dev: {
      ...dev,
      // Upstreams echo what the gateway sent them.
      outboundService: async (request: Request) =>
        Response.json({ upstream: true, url: request.url }),
    },
  });
  await Promise.all([admin.ready, gateway.ready]);
  gatewayUrl = (await gateway.url).origin;
  const adminUrl = (await admin.url).origin;
  const now = Math.floor(Date.now() / 1000);
  const assertion = await new SignJWT({ email: EMAIL })
    .setProtectedHeader({ alg: "RS256", kid: "test" })
    .setIssuer(`https://${TEAM}.cloudflareaccess.com`)
    .setAudience(AUD)
    .setIssuedAt(now - 60)
    .setExpirationTime(now + 600)
    .sign(access.privateKey);
  post = (pathname, body) =>
    fetch(`${adminUrl}/api/v1${pathname}`, {
      method: "POST",
      headers: {
        [HEADER.cfAccessJwtAssertion]: assertion,
        [HEADER.contentType]: MEDIA_TYPE.json,
      },
      body: JSON.stringify(body),
    });
});

afterAll(async () => {
  await gateway?.dispose();
  await admin?.dispose();
  for (const dir of [scaffoldRoot, adminCopy, gatewayCopy]) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("a third-party plugin", () => {
  it("scaffolds, publishes and runs in the gateway", async () => {
    const json = async (res: Response) => {
      expect(res.ok, await res.clone().text()).toBe(true);
      return (await res.json()) as { id: string };
    };
    const service = await json(
      await post("/services", {
        name: "demo",
        protocol: "https",
        host: "api.upstream.test",
        port: 443,
      }),
    );
    const route = await json(
      await post("/routes", {
        name: "demo",
        service_id: service.id,
        paths: ["/demo"],
      }),
    );
    // Validated against the scaffold's own schema: a wrong type is refused.
    const invalid = await post("/plugins", {
      name: NAME,
      route_id: route.id,
      config: { header_value: 42 },
    });
    expect(invalid.status).toBe(ERR.ADMIN_INVALID_REQUEST.status);
    await json(await post("/plugins", { name: NAME, route_id: route.id }));
    await json(await post("/config/publish", {}));

    const res = await fetch(`${gatewayUrl}/demo/items`);
    expect(res.status).toBe(200);
    // The scaffold's defaults: header `x-<name>: on`.
    expect(res.headers.get(`x-${NAME}`)).toBe("on");
    expect(await res.json()).toMatchObject({ upstream: true });
  });

  it("refuses a plugin the registry doesn't list", async () => {
    const res = await post("/plugins", { name: "not-bundled", config: {} });
    expect(res.status).toBe(ERR.ADMIN_PLUGIN_NOT_ENABLED.status);
  });
});
