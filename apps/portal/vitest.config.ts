import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  cloudflareTest,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers";
import { PORTAL } from "@edgway/constants";
import { exportJWK, generateKeyPair } from "jose";
import { defineConfig } from "vitest/config";

/**
 * The real admin Worker, bundled by wrangler as it deploys, minus its UI
 * build and assets (the portal publishes through it). It runs as an
 * auxiliary worker; nothing imports it.
 */
async function bundleAdmin(): Promise<{
  modulesRoot: string;
  scriptPath: string;
}> {
  const { derivedConfig } = await import("../../tools/wrangler-config.mjs");
  const { experimental_readRawConfig } = await import("wrangler");
  // Outside the repo, where the gates would lint the bundle.
  const outdir = path.join(tmpdir(), "edgway-portal-admin-bundle");
  const config = derivedConfig({
    readRawConfig: experimental_readRawConfig,
    config: path.join(import.meta.dirname, "../admin/wrangler.jsonc"),
    file: path.join(outdir, "admin.wrangler.json"),
    edit: () => ({ build: undefined, assets: undefined, services: undefined }),
  });
  execFileSync(
    "pnpm",
    [
      "exec",
      "wrangler",
      "deploy",
      "--dry-run",
      "--config",
      config,
      "--outdir",
      outdir,
    ],
    { cwd: path.join(import.meta.dirname, "../admin"), stdio: "ignore" },
  );
  // Named relative to its own directory (it is outside the working one).
  return { modulesRoot: outdir, scriptPath: path.join(outdir, "index.js") };
}

/** The test identity provider: its discovery document and keys are served below. */
const ISSUER = "https://idp.test";

export default defineConfig(async () => {
  const migrations = await readD1Migrations(
    path.join(import.meta.dirname, "../admin/migrations"),
  );
  // Stands in for the IdP's token-signing key.
  const idp = await generateKeyPair("RS256", { extractable: true });
  const idpJwk = {
    ...(await exportJWK(idp.publicKey)),
    kid: "idp",
    alg: "RS256",
  };
  // The deployed write limit (wrangler.jsonc) is the one the constants
  // name: a drift fails the tests.
  const { experimental_readRawConfig } = await import("wrangler");
  const { rawConfig } = experimental_readRawConfig({
    config: path.join(import.meta.dirname, "wrangler.jsonc"),
  });
  const writes = (
    rawConfig as { ratelimits?: { name: string; simple: unknown }[] }
  ).ratelimits?.find((r) => r.name === "PORTAL_WRITES")?.simple;
  const expected = {
    limit: PORTAL.writesPerMinute,
    period: PORTAL.writesPeriodSeconds,
  };
  if (JSON.stringify(writes) !== JSON.stringify(expected)) {
    throw new Error(
      `wrangler.jsonc PORTAL_WRITES must be ${JSON.stringify(expected)}`,
    );
  }
  let lastSql = "";
  let sqlQueries = 0;
  let downDiscoveries = 0;
  // The snapshot signing pair (the admin's secret, the gateway's public half).
  const signing = await generateKeyPair("EdDSA", { extractable: true });
  return {
    plugins: [
      cloudflareTest({
        main: "./src/worker.ts",
        miniflare: {
          compatibilityDate: "2025-04-14",
          compatibilityFlags: ["nodejs_compat"],
          d1Databases: ["DB"],
          ratelimits: {
            PORTAL_WRITES: { namespace_id: "1074", simple: expected },
          },
          // Not the portal's: the tests read what the admin published.
          kvNamespaces: ["CONFIG_KV"],
          bindings: {
            TEST_MIGRATIONS: migrations,
            TEST_IDP_KEY: JSON.stringify(await exportJWK(idp.privateKey)),
            TEST_PUBLIC_KEY: JSON.stringify(await exportJWK(signing.publicKey)),
            OIDC_ISSUER: ISSUER,
            OIDC_AUDIENCE: "edgway-portal",
            // The playground's API, plus an entry that isn't a URL.
            PORTAL_CONNECT_SRC: "https://api.example.test/v1, not-a-url",
          },
          // The admin's PortalPublish entrypoint: the portal holds no
          // signing key.
          serviceBindings: {
            ADMIN: { name: "edgway-admin", entrypoint: "PortalPublish" },
          },
          workers: [
            {
              name: "edgway-admin",
              modules: true,
              ...(await bundleAdmin()),
              compatibilityDate: "2025-04-14",
              compatibilityFlags: ["nodejs_compat"],
              // The same D1 and KV as the portal's (ids are binding names).
              d1Databases: { DB: "DB" },
              kvNamespaces: { CONFIG_KV: "CONFIG_KV" },
              durableObjects: {
                CONFIG_VERSION: { className: "ConfigVersion", useSQLite: true },
                PORTAL_PUBLISHER: {
                  className: "PortalPublisher",
                  useSQLite: true,
                },
              },
              bindings: {
                CONFIG_SIGNING_KEY: JSON.stringify(
                  await exportJWK(signing.privateKey),
                ),
              },
            },
          ],
          // The IdP's discovery document, JWKS and userinfo, and the
          // Analytics Engine SQL API; nothing else is reachable.
          // Userinfo answers for the bearer token's subject: `<sub>@example.test` and a name, none for a "noprofile"
          // subject, an email an admin's consumer holds for "clash", and an
          // email the IdP hasn't verified for "unverified".
          outboundService: async (request: Request) => {
            const url = new URL(request.url);
            // Analytics Engine's SQL API: one day's usage. The last
            // query is kept; `/__last-sql` reads it, so tests can see whose
            // usage was asked for.
            if (url.hostname === "api.cloudflare.com") {
              if (url.pathname === "/__last-sql") {
                return Response.json({ sql: lastSql, queries: sqlQueries });
              }
              lastSql = await request.text();
              sqlQueries++;
              return Response.json({
                data: [
                  { day: "2026-10-06 00:00:00", requests: "3", errors: "1" },
                ],
              });
            }
            // An IdP that never answers (pages don't wait for it).
            if (url.hostname === "hang.idp.test") return new Promise(() => {});
            // An IdP that fails at once, counting the discoveries it's asked
            // for; `/__count` reads the count (the back-off).
            if (url.hostname === "down.idp.test") {
              if (url.pathname === "/__count") {
                return Response.json({ discoveries: downDiscoveries });
              }
              downDiscoveries++;
              return Response.error();
            }
            if (url.origin !== ISSUER) return Response.error();
            if (url.pathname === "/.well-known/openid-configuration") {
              return Response.json({
                issuer: ISSUER,
                jwks_uri: `${ISSUER}/jwks`,
                userinfo_endpoint: `${ISSUER}/userinfo`,
                // On another host, as some IdPs' are (the CSP test).
                token_endpoint: "https://tokens.idp.test/token",
              });
            }
            if (url.pathname === "/userinfo") {
              const bearer = request.headers.get("authorization") ?? "";
              const payload = bearer.split(" ")[1]?.split(".")[1] ?? "";
              const { sub } = JSON.parse(
                Buffer.from(payload, "base64url").toString(),
              ) as { sub: string };
              if (sub.includes("noprofile")) return Response.json({ sub });
              return Response.json({
                sub,
                email: sub.includes("clash")
                  ? "taken@example.test"
                  : `${sub}@example.test`,
                email_verified: !sub.includes("unverified"),
                name: sub.includes("squat") ? "acme-partner" : `Name ${sub}`,
              });
            }
            return Response.json({ keys: [idpJwk] });
          },
        },
      }),
    ],
    test: {
      include: ["test/**/*.test.ts"],
      setupFiles: ["./test/apply-migrations.ts"],
    },
  };
});
