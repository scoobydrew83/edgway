#!/usr/bin/env node
/**
 * A local Edgway admin for the Terraform check (test/run.sh): the real admin
 * Worker (wrangler's unstable_startWorker, the admin's own pinned wrangler)
 * on a fresh local D1, with Cloudflare Access stubbed by a test key, a
 * Kong-Admin-Token for the Kong provider, and a snapshot signing key so
 * publishes work. It writes the Terraform variables to the file named by its
 * first argument, then serves until it is stopped.
 */
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { adminWithoutServices } from "../../../tools/wrangler-config.mjs";

const [varsFile, stateDir] = process.argv.slice(2);
if (!varsFile || !stateDir) {
  console.error("usage: local-admin.mjs <vars.json> <state dir>");
  process.exit(2);
}

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const adminConfig = path.join(root, "apps/admin/wrangler.jsonc");
// The admin's own dependencies (as tools/deploy.mjs resolves wrangler).
const fromAdmin = createRequire(adminConfig);
const { experimental_readRawConfig, unstable_startWorker } = await import(
  fromAdmin.resolve("wrangler")
);
const { exportJWK, generateKeyPair, SignJWT } = await import(
  fromAdmin.resolve("jose")
);

const TEAM = "edgway-terraform";
const AUD = "edgway-terraform-aud";
const EMAIL = "terraform@example.com";

rmSync(stateDir, { recursive: true, force: true });
mkdirSync(stateDir, { recursive: true });
const wrangler = path.join(
  path.dirname(fromAdmin.resolve("wrangler/package.json")),
  "bin/wrangler.js",
);
const migrate = spawnSync(
  process.execPath,
  [
    wrangler,
    "d1",
    "migrations",
    "apply",
    "DB",
    "--local",
    "--persist-to",
    stateDir,
    "--config",
    adminConfig,
  ],
  { cwd: path.dirname(adminConfig), stdio: "inherit" },
);
if (migrate.status !== 0) process.exit(migrate.status ?? 1);

const access = await generateKeyPair("RS256", { extractable: true });
const accessJwk = {
  ...(await exportJWK(access.publicKey)),
  kid: "test",
  alg: "RS256",
  use: "sig",
};
const signing = await generateKeyPair("EdDSA", { extractable: true });
const kongToken = randomBytes(32).toString("hex");
const kongHash = createHash("sha256").update(kongToken).digest("hex");

const admin = await unstable_startWorker({
  // Without the GATEWAY binding, which can't resolve under
  // unstable_startWorker.
  config: adminWithoutServices({
    readRawConfig: experimental_readRawConfig,
    config: adminConfig,
    file: path.join(stateDir, "admin.wrangler.json"),
  }),
  bindings: {
    ACCESS_TEAM: { type: "plain_text", value: TEAM },
    ACCESS_AUD: { type: "plain_text", value: AUD },
    ADMIN_ROLES: {
      type: "plain_text",
      value: JSON.stringify({ [EMAIL]: "publisher" }),
    },
    KONG_ADMIN_TOKENS: {
      type: "plain_text",
      value: JSON.stringify({ [kongHash]: "publisher" }),
    },
    CONFIG_SIGNING_KEY: {
      type: "plain_text",
      value: JSON.stringify(await exportJWK(signing.privateKey)),
    },
  },
  dev: {
    persist: stateDir,
    server: { hostname: "127.0.0.1", port: 0 },
    inspector: false,
    watch: false,
    logLevel: "none",
    // Cloudflare Access's certs for the test team; nothing else is reachable.
    outboundService: async (request) =>
      new URL(request.url).hostname === `${TEAM}.cloudflareaccess.com`
        ? Response.json({ keys: [accessJwk] })
        : Response.error(),
  },
});
await admin.ready;

const now = Math.floor(Date.now() / 1000);
const assertion = await new SignJWT({ email: EMAIL })
  .setProtectedHeader({ alg: "RS256", kid: "test" })
  .setIssuer(`https://${TEAM}.cloudflareaccess.com`)
  .setAudience(AUD)
  .setIssuedAt(now - 60)
  .setExpirationTime(now + 3600)
  .sign(access.privateKey);

writeFileSync(
  varsFile,
  JSON.stringify(
    {
      admin_url: (await admin.url).origin,
      kong_admin_token: kongToken,
      admin_headers: { "cf-access-jwt-assertion": assertion },
    },
    null,
    2,
  ),
);
console.log(`local admin ready: ${(await admin.url).origin}`);

const stop = async () => {
  await admin.dispose();
  process.exit(0);
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
