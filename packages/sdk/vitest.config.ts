import { execFileSync } from "node:child_process";
import path from "node:path";
import {
  cloudflareTest,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers";
import { exportJWK, generateKeyPair } from "jose";
import { defineConfig } from "vitest/config";

/** The test Access team: its certs are served by the outbound stub below. */
const TEAM = "edgway-sdk-test";
const AUD = "edgway-sdk-aud";
/** The admin and the test runner share one D1 database (same id). */
const D1_ID = "edgway-sdk-test-db";

const admin = path.join(import.meta.dirname, "../../apps/admin");

/**
 * The real admin Worker, bundled by wrangler exactly as it deploys; it runs
 * as an auxiliary worker, so the smoke test calls it over HTTP (no imports).
 */
function bundleAdmin(): string {
  // Inside the package (workerd won't load an auxiliary script from outside
  // it), under node_modules so no gate lints or cruises the bundle.
  const outdir = path.join(
    import.meta.dirname,
    "node_modules/.cache/admin-bundle",
  );
  execFileSync(
    "pnpm",
    ["exec", "wrangler", "deploy", "--dry-run", "--outdir", outdir],
    { cwd: admin, stdio: "ignore" },
  );
  return path.join(outdir, "index.js");
}

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(admin, "migrations"));
  // Stands in for Cloudflare Access's signing key.
  const access = await generateKeyPair("RS256", { extractable: true });
  const publicJwk = {
    ...(await exportJWK(access.publicKey)),
    kid: "test",
    alg: "RS256",
    use: "sig",
  };
  return {
    plugins: [
      cloudflareTest({
        miniflare: {
          compatibilityDate: "2025-04-14",
          compatibilityFlags: ["nodejs_compat"],
          d1Databases: { DB: D1_ID },
          bindings: {
            TEST_MIGRATIONS: migrations,
            TEST_ACCESS_KEY: JSON.stringify(await exportJWK(access.privateKey)),
            ACCESS_TEAM: TEAM,
            ACCESS_AUD: AUD,
          },
          serviceBindings: { ADMIN: "admin" },
          workers: [
            {
              name: "admin",
              modules: true,
              scriptPath: bundleAdmin(),
              compatibilityDate: "2025-04-14",
              compatibilityFlags: ["nodejs_compat"],
              d1Databases: { DB: D1_ID },
              kvNamespaces: ["CONFIG_KV"],
              durableObjects: {
                CONFIG_VERSION: { className: "ConfigVersion", useSQLite: true },
              },
              bindings: {
                ACCESS_TEAM: TEAM,
                ACCESS_AUD: AUD,
                ADMIN_ROLES: JSON.stringify({ "sdk@example.com": "editor" }),
              },
              // Cloudflare Access's certs endpoint for the test team.
              outboundService: async (request: Request) => {
                if (
                  new URL(request.url).hostname ===
                  `${TEAM}.cloudflareaccess.com`
                ) {
                  return Response.json({ keys: [publicJwk] });
                }
                return Response.error();
              },
            },
          ],
        },
      }),
    ],
    test: { setupFiles: ["./test/apply-migrations.ts"] },
  };
});
