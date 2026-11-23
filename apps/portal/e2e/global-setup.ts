/**
 * The portal's end-to-end environment, all local:
 *   - a mock OIDC provider (oauth2-mock-server, Drew's decision);
 *   - the gateway, the admin and the portal in one Miniflare,
 *     so the portal's `ADMIN` and the gateway's `CONFIG_VERSION` Service
 *     Bindings reach the admin's entrypoints, on one persisted state (D1
 *     migrations applied) with a fresh snapshot signing pair;
 *   - through the admin: a service, a route `/pw` with key-auth, published.
 * Each Worker is bundled as wrangler deploys it; the portal's build makes
 * the site with the provider's issuer and client id.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { CLI, HEADER, MEDIA_TYPE } from "@edgway/constants";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import {
  convertV4MiniflareOptions,
  Log,
  LogLevel,
  Miniflare,
  type V4WorkerOptions,
} from "miniflare";
import { Events, OAuth2Server } from "oauth2-mock-server";
import {
  experimental_readRawConfig,
  unstable_getMiniflareWorkerOptions,
} from "wrangler";
import { derivedConfig } from "../../../tools/wrangler-config.mjs";

const CLIENT_ID = "edgway-portal";
const DEVELOPER = "pw-developer";
const TEAM = "edgway-portal-e2e";
const AUD = "edgway-portal-e2e-aud";
const ADMIN_EMAIL = "e2e@example.com";

/** A free local port, for the IdP's issuer URL (built into the site). */
const freePort = () =>
  new Promise<number>((resolve) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });

export default async function globalSetup() {
  const repo = path.resolve(import.meta.dirname, "../../..");
  const state = path.resolve(import.meta.dirname, "../.e2e-state");
  rmSync(state, { recursive: true, force: true });
  mkdirSync(state, { recursive: true });
  // The identity provider: every token is the test developer's, for the portal.
  const idp = new OAuth2Server();
  await idp.issuer.keys.generate("RS256");
  // Zudoku shows API keys only to a verified email. The IdP's display name
  // is a username an operator will give a consumer later.
  const identity = {
    sub: DEVELOPER,
    email: `${DEVELOPER}@example.com`,
    email_verified: true,
    name: "acme-partner",
  };
  idp.service.on(Events.BeforeTokenSigning, (token) => {
    Object.assign(token.payload, identity, { aud: CLIENT_ID });
  });
  idp.service.on(Events.BeforeUserinfo, (userInfo) => {
    Object.assign(userInfo.body, identity);
  });
  await idp.start(await freePort(), "localhost");
  const issuer = idp.issuer.url as string;
  // Read by the portal's build (zudoku.config.tsx), run by wrangler below.
  process.env.ZUDOKU_PUBLIC_OIDC_ISSUER = issuer;
  process.env.ZUDOKU_PUBLIC_OIDC_CLIENT_ID = CLIENT_ID;
  // A public API reference: any OpenAPI document, here the admin's.
  process.env.ZUDOKU_PUBLIC_PORTAL_OPENAPI = path.join(
    repo,
    "apps/admin/openapi.json",
  );
  // The landing page's first request.
  process.env.ZUDOKU_PUBLIC_GATEWAY_URL = "https://api.example.test/";

  const wrangler = path.join(
    path.dirname(
      createRequire(import.meta.url).resolve("wrangler/package.json"),
    ),
    "bin/wrangler.js",
  );
  const adminConfig = path.join(repo, CLI.adminConfig);
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
    { cwd: path.dirname(adminConfig), stdio: "inherit" },
  );
  if (migrate.status !== 0) throw new Error("migrations failed");

  // Outside the repo, where the gates would lint the bundles.
  const bundles = mkdtempSync(path.join(tmpdir(), "edgway-portal-e2e-"));
  /**
   * A Worker's Miniflare options from its wrangler config, running the
   * bundle `wrangler deploy --dry-run` makes (the build included).
   */
  const worker = (
    name: string,
    config: string,
    extra: { bindings?: Record<string, string> } & Record<string, unknown>,
  ): V4WorkerOptions => {
    const outdir = path.join(bundles, name);
    const bundle = spawnSync(
      process.execPath,
      [wrangler, "deploy", "--dry-run", "--config", config, "--outdir", outdir],
      { cwd: path.dirname(config), stdio: "ignore", env: process.env },
    );
    if (bundle.status !== 0) throw new Error(`bundling ${name} failed`);
    // Typed against the Miniflare wrangler's types were built with; the
    // options are Miniflare's v4 worker options.
    const { workerOptions } = unstable_getMiniflareWorkerOptions(
      config,
    ) as unknown as {
      workerOptions: V4WorkerOptions;
    };
    return {
      ...workerOptions,
      ...extra,
      // The bundle is one module, named relative to its own directory.
      rootPath: undefined,
      modulesRules: undefined,
      modulesRoot: outdir,
      name,
      modules: true,
      // Named after the config's `main` (index.js, worker.js).
      scriptPath: path.join(
        outdir,
        readdirSync(outdir).find((file) => file.endsWith(".js")) ?? "",
      ),
      bindings: {
        ...workerOptions.bindings,
        ...extra.bindings,
      },
      // Each Worker on its own local port.
      unsafeDirectSockets: [{ host: "127.0.0.1", port: 0 }],
    };
  };

  const signing = await generateKeyPair("EdDSA", { extractable: true });
  // The admin, with Cloudflare Access stubbed by a test key.
  const access = await generateKeyPair("RS256", { extractable: true });
  const accessJwk = {
    ...(await exportJWK(access.publicKey)),
    kid: "test",
    alg: "RS256",
    use: "sig",
  };
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      log: new Log(LogLevel.NONE),
      resourcePersistencePath: path.join(state, "v3"),
      workers: [
        // Without its UI build and assets.
        worker(
          "edgway-admin",
          derivedConfig({
            readRawConfig: experimental_readRawConfig,
            config: adminConfig,
            file: path.join(state, "admin.wrangler.json"),
            edit: () => ({ build: undefined, assets: undefined }),
          }),
          {
            bindings: {
              ACCESS_TEAM: TEAM,
              ACCESS_AUD: AUD,
              ADMIN_ROLES: JSON.stringify({ [ADMIN_EMAIL]: "publisher" }),
              CONFIG_SIGNING_KEY: JSON.stringify(
                await exportJWK(signing.privateKey),
              ),
            },
            outboundService: async (request: Request) =>
              new URL(request.url).hostname === `${TEAM}.cloudflareaccess.com`
                ? Response.json({ keys: [accessJwk] })
                : Response.error(),
          },
        ),
        // Without Workers AI (always remote).
        worker(
          "edgway-gateway",
          derivedConfig({
            readRawConfig: experimental_readRawConfig,
            config: path.join(repo, CLI.gatewayConfig),
            file: path.join(state, "gateway.wrangler.json"),
            edit: () => ({ ai: undefined }),
          }),
          {
            bindings: {
              CONFIG_PUBLIC_KEY: JSON.stringify(
                await exportJWK(signing.publicKey),
              ),
            },
            // Upstreams echo what the gateway sent them.
            outboundService: async (request: Request) =>
              Response.json({ upstream: true, url: request.url }),
          },
        ),
        // Its outbound is the network: the mock IdP on localhost.
        worker(
          "edgway-portal",
          path.join(import.meta.dirname, "../wrangler.jsonc"),
          { bindings: { OIDC_ISSUER: issuer, OIDC_AUDIENCE: CLIENT_ID } },
        ),
      ],
    }),
  );
  await mf.ready;
  const now = Math.floor(Date.now() / 1000);
  const assertion = await new SignJWT({ email: ADMIN_EMAIL })
    .setProtectedHeader({ alg: "RS256", kid: "test" })
    .setIssuer(`https://${TEAM}.cloudflareaccess.com`)
    .setAudience(AUD)
    .setIssuedAt(now - 60)
    .setExpirationTime(now + 600)
    .sign(access.privateKey);
  const adminUrl = (await mf.unsafeGetDirectURL("edgway-admin")).origin;
  const post = async (pathname: string, body: unknown) => {
    const res = await fetch(`${adminUrl}/api/v1${pathname}`, {
      method: "POST",
      headers: {
        [HEADER.cfAccessJwtAssertion]: assertion,
        [HEADER.contentType]: MEDIA_TYPE.json,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${pathname}: ${await res.text()}`);
    return (await res.json()) as { id: string };
  };
  const service = await post("/services", {
    name: "pw",
    protocol: "https",
    host: "api.upstream.test",
    port: 443,
  });
  const route = await post("/routes", {
    name: "pw",
    service_id: service.id,
    paths: ["/pw"],
  });
  await post("/plugins", {
    name: "key-auth",
    route_id: route.id,
    config: { key_names: ["apikey"] },
  });
  await post("/config/publish", {});

  // The admin API, for checks on what the portal did.
  process.env.E2E_ADMIN_URL = adminUrl;
  process.env.E2E_ADMIN_ASSERTION = assertion;
  process.env.E2E_PORTAL_URL = (
    await mf.unsafeGetDirectURL("edgway-portal")
  ).origin;
  process.env.E2E_GATEWAY_URL = (
    await mf.unsafeGetDirectURL("edgway-gateway")
  ).origin;

  return async () => {
    await mf.dispose();
    rmSync(bundles, { recursive: true, force: true });
    await idp.stop();
  };
}
