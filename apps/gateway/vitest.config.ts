import { createHash } from "node:crypto";
import path from "node:path";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { CONFIG } from "@edgway/constants";
import { exportJWK, generateKeyPair } from "jose";
import { defineConfig } from "vitest/config";
import { snapshotFromDeck } from "./test/deck-snapshot";

/**
 * The admin's ConfigVersion DO as a module (`current`, `compareAndSet`), and
 * its read-only `ConfigVersionReader` entrypoint, which the gateway binds
 *. The test setup moves the version through the DO directly.
 */
const CONFIG_VERSION_STAND_IN = [
  'import { DurableObject, WorkerEntrypoint } from "cloudflare:workers";',
  "export class ConfigVersion extends DurableObject {",
  '  current() { return this.ctx.storage.get("version"); }',
  "  async compareAndSet(expected, next) {",
  '    if ((await this.ctx.storage.get("version")) !== expected) return false;',
  '    await this.ctx.storage.put("version", next);',
  "    return true;",
  "  }",
  "}",
  "export class ConfigVersionReader extends WorkerEntrypoint {",
  "  current() {",
  "    const ns = this.env.CONFIG_VERSION;",
  `    return ns.get(ns.idFromName(${JSON.stringify(CONFIG.versionObjectName)})).current();`,
  "  }",
  "}",
  "export default { fetch: () => new Response(null, { status: 404 }) };",
].join("\n");

/** The stand-in OpenID provider's issuer. */
const IDP = "https://idp.test";
/** The stand-in LLM provider, OpenAI's chat format. */
const LLM = "https://llm.test";

export default defineConfig(async () => {
  // The data plane runs on a snapshot of examples/deck/demo.yaml, signed with
  // a test key pair (the admin signs real ones).
  const snapshot = snapshotFromDeck(
    path.join(import.meta.dirname, "../../examples/deck/demo.yaml"),
  );
  // A route with no service: requests to /broken fail with a 5xx (the
  // error-logging test).
  snapshot.routes.push({ id: "route_broken", paths: ["/broken"] });
  // A jwt route whose HS256 secret is a vault reference: the gateway
  // resolves it from its own env (VAULT_JWT_DEMO_SECRET below).
  const service = snapshot.services[0]?.id;
  snapshot.routes.push({
    id: "route_vault_jwt",
    service_id: service,
    paths: ["/vault-jwt"],
  });
  snapshot.consumers.push({ id: "consumer_vault", username: "vault-user" });
  snapshot.jwt_secrets = [
    ...(snapshot.jwt_secrets ?? []),
    {
      id: "jwt_vault",
      consumer_id: "consumer_vault",
      key: "vault-issuer",
      algorithm: "HS256",
      secret: "{vault://env/vault-jwt-demo-secret}",
    },
  ];
  snapshot.plugins.push({
    id: "plugin_vault_jwt",
    name: "jwt",
    route_id: "route_vault_jwt",
    config: {},
  });
  // identity. Two key-auth consumers, "gold" in a consumer group;
  // /identity runs jwt and key-auth (both with an anonymous fallback) and a
  // gold-only rate limit.
  const keyHash = (key: string) =>
    createHash("sha256").update(key).digest("hex");
  snapshot.consumers.push(
    { id: "consumer_gold", username: "gold-user" },
    { id: "consumer_plain", username: "plain-user" },
    { id: "consumer_anon", username: "anonymous" },
  );
  snapshot.keyauth_credentials = [
    ...(snapshot.keyauth_credentials ?? []),
    {
      id: "key_gold",
      consumer_id: "consumer_gold",
      key_hash: keyHash("gold-key"),
    },
    {
      id: "key_plain",
      consumer_id: "consumer_plain",
      key_hash: keyHash("plain-key"),
    },
  ];
  snapshot.consumer_groups = [{ id: "group_gold", name: "gold" }];
  snapshot.consumer_group_consumers = [
    { consumer_group_id: "group_gold", consumer_id: "consumer_gold" },
  ];
  snapshot.routes.push({
    id: "route_identity",
    service_id: service,
    paths: ["/identity"],
  });
  snapshot.plugins.push(
    {
      id: "plugin_identity_jwt",
      name: "jwt",
      route_id: "route_identity",
      config: { anonymous: "consumer_anon" },
    },
    {
      id: "plugin_identity_key",
      name: "key-auth",
      route_id: "route_identity",
      config: { key_names: ["x-api-key"], anonymous: "consumer_anon" },
    },
    {
      id: "plugin_identity_gold_limit",
      name: "rate-limiting",
      route_id: "route_identity",
      consumer_group_id: "group_gold",
      config: { minute: 1, limit_by: "consumer", policy: "local" },
    },
  );
  // an openid-connect route with no consumer mapping (no
  // consumer_claim), against a stand-in IdP served by outboundService below.
  const idpKeys = await generateKeyPair("RS256", { extractable: true });
  const idpJwk = {
    ...(await exportJWK(idpKeys.publicKey)),
    kid: "idp-1",
    alg: "RS256",
  };
  snapshot.routes.push({
    id: "route_oidc",
    service_id: service,
    paths: ["/oidc"],
  });
  snapshot.plugins.push({
    id: "plugin_oidc",
    name: "openid-connect",
    route_id: "route_oidc",
    config: { issuer: IDP, auth_methods: ["bearer"] },
  });
  // an AI route. ai-prompt-guard, a token limit (30 per minute per
  // client IP for openai) and ai-proxy against the stand-in provider.
  snapshot.services.push({
    id: "service_llm",
    name: "llm",
    protocol: "https",
    host: "llm.test",
    port: 443,
    path: "/",
  });
  snapshot.routes.push({
    id: "route_ai",
    service_id: "service_llm",
    paths: ["/ai"],
  });
  snapshot.plugins.push(
    {
      id: "plugin_ai_guard",
      name: "ai-prompt-guard",
      route_id: "route_ai",
      config: { deny_patterns: ["forbidden"] },
    },
    {
      id: "plugin_ai_limit",
      name: "ai-rate-limiting-advanced",
      route_id: "route_ai",
      config: {
        identifier: "ip",
        llm_providers: [{ name: "openai", limit: 30, window_size: 60 }],
      },
    },
    {
      id: "plugin_ai_proxy",
      name: "ai-proxy",
      route_id: "route_ai",
      config: {
        route_type: "llm/v1/chat",
        auth: { header_name: "Authorization", header_value: "Bearer llm-key" },
        model: {
          provider: "openai",
          options: { upstream_url: `${LLM}/v1/chat/completions` },
        },
      },
    },
  );
  const snapshotJson = JSON.stringify(snapshot);
  const keys = await generateKeyPair("EdDSA", { extractable: true });

  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        // Workers AI has no local simulator and the tests open no remote
        // session: the AI binding is a stub that fails when called, so
        // ai-proxy's Workers AI fallback fails too.
        remoteBindings: false,
        miniflare: {
          // The admin Worker's ConfigVersion DO (wrangler binds it by
          // script_name): a stand-in with the same RPC methods.
          workers: [
            {
              name: "edgway-admin",
              modules: true,
              compatibilityDate: "2025-04-14",
              script: CONFIG_VERSION_STAND_IN,
              durableObjects: { CONFIG_VERSION: "ConfigVersion" },
            },
          ],
          // The test setup's way to move the live version (the gateway's own
          // CONFIG_VERSION is the read-only reader).
          durableObjects: {
            TEST_CONFIG_VERSION: {
              className: "ConfigVersion",
              scriptName: "edgway-admin",
            },
          },
          bindings: {
            TEST_SNAPSHOT: snapshotJson,
            // Hashed here: importing @edgway/core in the setup file would
            // create its module-level objects in the test's request context.
            TEST_SNAPSHOT_SHA256: createHash("sha256")
              .update(snapshotJson)
              .digest("hex"),
            TEST_SIGNING_KEY: JSON.stringify(await exportJWK(keys.privateKey)),
            CONFIG_PUBLIC_KEY: JSON.stringify(await exportJWK(keys.publicKey)),
            // The stand-in IdP's signing key (tests mint bearer tokens).
            TEST_IDP_KEY: JSON.stringify(await exportJWK(idpKeys.privateKey)),
            TEST_IDP_ISSUER: IDP,
            // The secret behind {vault://env/vault-jwt-demo-secret}.
            VAULT_JWT_DEMO_SECRET: "gateway-test-jwt-secret",
          },
          // Stand-in for httpbin.org: echoes what the gateway sent upstream.
          outboundService: async (request: Request) => {
            const url = new URL(request.url);
            // A stand-in OpenID provider: discovery and JWKS.
            if (url.origin === IDP) {
              if (url.pathname === "/.well-known/openid-configuration") {
                return Response.json({
                  issuer: IDP,
                  jwks_uri: `${IDP}/jwks`,
                  authorization_endpoint: `${IDP}/authorize`,
                  token_endpoint: `${IDP}/token`,
                  response_types_supported: ["code"],
                  subject_types_supported: ["public"],
                  id_token_signing_alg_values_supported: ["RS256"],
                });
              }
              if (url.pathname === "/jwks") {
                return Response.json({ keys: [idpJwk] });
              }
            }
            // A stand-in OpenAI-format provider: model "slow" answers after
            // 5 s, "fail" never answers; each answer uses 20 tokens.
            if (url.origin === LLM) {
              const body = (await request.json()) as { model?: string };
              // No answer at all (a network failure).
              if (body.model === "fail") return Response.error();
              if (body.model === "slow") {
                await new Promise((resolve) => setTimeout(resolve, 5000));
              }
              return Response.json({
                id: "chatcmpl-test",
                object: "chat.completion",
                model: body.model,
                choices: [
                  {
                    index: 0,
                    message: {
                      role: "assistant",
                      content: request.headers.get("authorization"),
                    },
                    finish_reason: "stop",
                  },
                ],
                usage: {
                  prompt_tokens: 12,
                  completion_tokens: 8,
                  total_tokens: 20,
                },
              });
            }
            return Response.json({
              upstream: true,
              url: request.url,
              method: request.method,
              headers: Object.fromEntries(request.headers),
              body: await request.text(),
            });
          },
        },
      }),
    ],
    test: {
      setupFiles: ["./test/publish-snapshot.ts"],
    },
  };
});
