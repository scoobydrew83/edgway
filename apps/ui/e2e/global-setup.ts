/**
 * Starts the admin Worker for the UI tests: a fresh local D1 (the admin's
 * migrations), the built UI as its assets, and Cloudflare Access stubbed by
 * a test key whose assertion the tests send. The gateway Worker runs beside
 * it on the same local state (the config KV), with the snapshot key pair the
 * admin signs publishes and route-tester traces with.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { CLI } from "@edgway/constants";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { experimental_readRawConfig, unstable_startWorker } from "wrangler";
import {
  adminWithoutServices,
  derivedConfig,
} from "../../../tools/wrangler-config.mjs";

const TEAM = "edgway-ui-e2e";
const AUD = "edgway-ui-aud";
const EMAIL = "e2e@example.com";
/** A viewer, for the role-aware console. */
const VIEWER_EMAIL = "e2e-viewer@example.com";
/** The Workers' own logs: none, unless asked for (CI asks, for warnings and errors). */
const LOG_LEVEL =
  (process.env.E2E_WORKER_LOG as "warn" | "error" | undefined) ?? "none";

export default async function globalSetup() {
  const repo = path.resolve(import.meta.dirname, "../../..");
  const adminConfig = path.join(repo, CLI.adminConfig);
  const state = path.resolve(import.meta.dirname, "../.e2e-state");
  rmSync(state, { recursive: true, force: true });
  mkdirSync(state, { recursive: true });

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
    { cwd: path.dirname(adminConfig), stdio: "inherit" },
  );
  if (migrate.status !== 0) throw new Error("migrations failed");

  // The snapshot signing pair: the admin's secret, the gateway's public half.
  const signing = await generateKeyPair("EdDSA", { extractable: true });
  // The route tester's own trace-token pair.
  const trace = await generateKeyPair("EdDSA", { extractable: true });
  const gateway = await unstable_startWorker({
    config: gatewayConfig(path.join(repo, CLI.gatewayConfig), state),
    bindings: {
      CONFIG_PUBLIC_KEY: {
        type: "plain_text",
        value: JSON.stringify(await exportJWK(signing.publicKey)),
      },
      TRACE_PUBLIC_KEY: {
        type: "plain_text",
        value: JSON.stringify(await exportJWK(trace.publicKey)),
      },
    },
    dev: {
      persist: state,
      server: { hostname: "127.0.0.1", port: 0 },
      inspector: false,
      watch: false,
      logLevel: LOG_LEVEL,
      // Upstreams echo what the gateway sent them.
      outboundService: async (request: Request) =>
        Response.json({ upstream: true, url: request.url }),
    },
  });
  await gateway.ready;
  const gatewayOrigin = (await gateway.url).origin;

  const access = await generateKeyPair("RS256", { extractable: true });
  const publicJwk = {
    ...(await exportJWK(access.publicKey)),
    kid: "test",
    alg: "RS256",
    use: "sig",
  };
  const admin = await unstable_startWorker({
    config: adminConfigFor(adminConfig, state),
    bindings: {
      ACCESS_TEAM: { type: "plain_text", value: TEAM },
      ACCESS_AUD: { type: "plain_text", value: AUD },
      ADMIN_ROLES: {
        type: "plain_text",
        value: JSON.stringify({
          [EMAIL]: "publisher",
          [VIEWER_EMAIL]: "viewer",
        }),
      },
      CONFIG_SIGNING_KEY: {
        type: "plain_text",
        value: JSON.stringify(await exportJWK(signing.privateKey)),
      },
      TRACE_SIGNING_KEY: {
        type: "plain_text",
        value: JSON.stringify(await exportJWK(trace.privateKey)),
      },
      GATEWAY_URL: { type: "plain_text", value: gatewayOrigin },
    },
    dev: {
      persist: state,
      server: { hostname: "127.0.0.1", port: 0 },
      inspector: false,
      watch: false,
      logLevel: LOG_LEVEL,
      // Access's certs; the route tester's calls reach the local gateway.
      outboundService: async (request: Request) => {
        const url = new URL(request.url);
        if (url.hostname === `${TEAM}.cloudflareaccess.com`) {
          return Response.json({ keys: [publicJwk] });
        }
        if (url.origin !== gatewayOrigin) return Response.error();
        // Re-made in Node's own fetch (miniflare's Request is another undici's).
        const body = ["GET", "HEAD"].includes(request.method)
          ? undefined
          : await request.arrayBuffer();
        return fetch(request.url, {
          method: request.method,
          headers: Object.fromEntries(request.headers),
          body,
        });
      },
    },
  });
  await admin.ready;
  const now = Math.floor(Date.now() / 1000);
  process.env.E2E_BASE_URL = (await admin.url).origin;
  const assertion = (email: string) =>
    new SignJWT({ email })
      .setProtectedHeader({ alg: "RS256", kid: "test" })
      .setIssuer(`https://${TEAM}.cloudflareaccess.com`)
      .setAudience(AUD)
      .setIssuedAt(now - 60)
      .setExpirationTime(now + 3600)
      .sign(access.privateKey);
  process.env.E2E_TOKEN = await assertion(EMAIL);
  process.env.E2E_VIEWER_TOKEN = await assertion(VIEWER_EMAIL);

  return async () => {
    await admin.dispose();
    await gateway.dispose();
  };
}

/**
 * The gateway without its Service Binding to the admin's ConfigVersionReader
 * (another dev session's; it reads the KV pointer instead, Drew)
 * or Workers AI, which has no local simulator.
 */
const gatewayConfig = (config: string, state: string) =>
  derivedConfig({
    readRawConfig: experimental_readRawConfig,
    config,
    file: path.join(state, "gateway.wrangler.json"),
    edit: () => ({ ai: undefined, services: undefined }),
  });

/**
 * The admin without its GATEWAY service binding: the route tester reaches
 * the local gateway through GATEWAY_URL instead.
 */
const adminConfigFor = (config: string, state: string) =>
  adminWithoutServices({
    readRawConfig: experimental_readRawConfig,
    config,
    file: path.join(state, "admin.wrangler.json"),
  });
