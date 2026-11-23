import { execFileSync } from "node:child_process";
import path from "node:path";
import {
  cloudflareTest,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers";
import { exportJWK, generateKeyPair } from "jose";
import { defineConfig } from "vitest/config";

/** The test Access team: its certs are served by the outbound stub below. */
const TEAM = "edgway-test";

/** Both Workers bind the same config KV namespace: wrangler.jsonc gives no id, so locally its id is the binding name. */
const CONFIG_KV_ID = "CONFIG_KV";

/**
 * The real gateway Worker, bundled by wrangler exactly as it deploys, for the
 * publish end-to-end test (it runs as an auxiliary worker; nothing imports it).
 */
function bundleGateway(): string {
  // Inside the project: workerd won't load an auxiliary script from outside it.
  const outdir = path.join(import.meta.dirname, ".gateway-bundle");
  execFileSync(
    "pnpm",
    ["exec", "wrangler", "deploy", "--dry-run", "--outdir", outdir],
    { cwd: path.join(import.meta.dirname, "../gateway"), stdio: "ignore" },
  );
  return path.join(outdir, "index.js");
}

export default defineConfig(async () => {
  const migrations = await readD1Migrations(
    path.join(import.meta.dirname, "migrations"),
  );
  // Stands in for Cloudflare Access's signing key.
  const access = await generateKeyPair("RS256", { extractable: true });
  const publicJwk = {
    ...(await exportJWK(access.publicKey)),
    kid: "test",
    alg: "RS256",
    use: "sig",
  };
  // The snapshot signing pair: the admin's secret and the gateway's public half.
  const signing = await generateKeyPair("EdDSA", { extractable: true });
  // The route tester's trace-token pair, a key of its own.
  const trace = await generateKeyPair("EdDSA", { extractable: true });
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            TEST_ACCESS_KEY: JSON.stringify(await exportJWK(access.privateKey)),
            ACCESS_TEAM: TEAM,
            ACCESS_AUD: "edgway-admin-aud",
            ADMIN_ROLES: JSON.stringify({
              "viewer@example.com": "viewer",
              "editor@example.com": "editor",
              "publisher@example.com": "publisher",
              "owner@example.com": "owner",
              "ci-token.access": "editor",
            }),
            // sha256("kong-<role>-token") → role, for the Kong mount tests.
            KONG_ADMIN_TOKENS: JSON.stringify({
              "231727837b837454474bd30b8de85a1706a6b6c8a2f0bef1ecf9fe248383da28":
                "viewer",
              "3f16ce74ab4e36d294ba6444546f028eb9c220a130ae3e3d61c1c69b34f2c075":
                "editor",
              "43efdb9d7d24586232477c0c8fab08794addf42d5f1024cf6d94b6eb80c326bd":
                "publisher",
            }),
            CONFIG_SIGNING_KEY: JSON.stringify(
              await exportJWK(signing.privateKey),
            ),
            TRACE_SIGNING_KEY: JSON.stringify(
              await exportJWK(trace.privateKey),
            ),
          },
          serviceBindings: { GATEWAY: "gateway" },
          // Cloudflare Access's certs endpoint for the test team, and the
          // Analytics Engine SQL API.
          outboundService: async (request: Request) => {
            const url = new URL(request.url);
            if (url.hostname === `${TEAM}.cloudflareaccess.com`) {
              return Response.json({ keys: [publicJwk] });
            }
            // Analytics Engine's SQL API: one row per overview query.
            if (url.hostname === "api.cloudflare.com") {
              const sql = await request.text();
              const data = sql.includes("GROUP BY hour")
                ? [
                    {
                      hour: "2026-10-02 10:00:00",
                      requests: "12",
                      errors: "1",
                      mean_ms: 4.5,
                    },
                  ]
                : sql.includes("p50_ms")
                  ? [{ p50_ms: 3.25, p99_ms: 18 }]
                  : sql.includes("GROUP BY consumer")
                    ? [{ consumer: "c1", requests: "7", errors: "0" }]
                    : [{ route: "r1", requests: "12", errors: "1" }];
              return Response.json({
                data,
                auth: request.headers.get("authorization"),
              });
            }
            // No other host is reachable from the tests.
            return Response.error();
          },
          workers: [
            {
              name: "gateway",
              modules: true,
              scriptPath: bundleGateway(),
              compatibilityDate: "2025-04-14",
              compatibilityFlags: ["nodejs_compat"],
              kvNamespaces: { CONFIG_KV: CONFIG_KV_ID },
              durableObjects: {
                RATE_LIMIT_COUNTER: {
                  className: "RateLimitCounter",
                  useSQLite: true,
                },
              },
              bindings: {
                CONFIG_PUBLIC_KEY: JSON.stringify(
                  await exportJWK(signing.publicKey),
                ),
                TRACE_PUBLIC_KEY: JSON.stringify(
                  await exportJWK(trace.publicKey),
                ),
              },
              // Upstreams echo what the gateway sent them.
              outboundService: async (request: Request) =>
                Response.json({ upstream: true, url: request.url }),
            },
          ],
        },
      }),
    ],
    test: {
      // Only the admin's own tests: not a scaffolded plugin's under
      // .e2e-plugins/ (apps/cli's plugin e2e).
      include: ["test/**/*.test.ts"],
      setupFiles: ["./test/apply-migrations.ts"],
    },
  };
});
