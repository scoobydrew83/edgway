import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { HEADER } from "@edgway/constants";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      main: "./src/index.ts",
      miniflare: {
        compatibilityDate: "2025-04-14",
        compatibilityFlags: ["nodejs_compat"],
        kvNamespaces: ["CONFIG_KV"],
        workerLoaders: { LOADER: {} },
        // A capability a sandboxed plugin may be allow-listed.
        serviceBindings: {
          CAPABILITY: async (request: Request) =>
            new Response(`capability:${new URL(request.url).pathname}`),
        },
        durableObjects: {
          CONFIG_VERSION: "ConfigVersion",
          RATE_LIMIT_COUNTER: {
            className: "RateLimitCounter",
            useSQLite: true,
          },
        },
        ratelimits: {
          RATE_LIMIT: {
            namespace_id: "1001",
            simple: { limit: 3, period: 60 },
          },
        },
        // Stand-in for public upstreams and Tunnel hostnames: echoes the request.
        // down.internal is unavailable (passive-health tests).
        outboundService: async (request: Request) => {
          // An upstream that redirects elsewhere.
          if (new URL(request.url).hostname === "redirect.test") {
            return Response.redirect("https://elsewhere.test/stolen");
          }
          if (new URL(request.url).hostname === "down.internal") {
            // The test sets the status it wants in x-test-status.
            return new Response(null, {
              status: Number(request.headers.get("x-test-status")),
            });
          }
          // An upstream that tries to answer with a trace of its own.
          const spoof = { [HEADER.trace]: "[]" };
          return Response.json(
            {
              url: request.url,
              method: request.method,
              host: request.headers.get(HEADER.host),
              forwardedFor: request.headers.get(HEADER.forwardedFor),
              forwardedProto: request.headers.get(HEADER.forwardedProto),
              forwardedHost: request.headers.get(HEADER.forwardedHost),
              forwardedPort: request.headers.get(HEADER.forwardedPort),
              realIp: request.headers.get(HEADER.realIp),
              consumerId: request.headers.get(HEADER.consumerId),
              accessId: request.headers.get(HEADER.cfAccessClientId),
              traceToken: request.headers.get(HEADER.traceToken),
              body: await request.text(),
            },
            { headers: spoof },
          );
        },
      },
    }),
  ],
  test: { include: ["test/**/*.test.ts"] },
});
