import {
  createExecutionContext,
  env,
  waitOnExecutionContext,
} from "cloudflare:test";
import { KV_KEY, VAULTS } from "@edgway/constants";
import { sha256Hex } from "@edgway/core";
import { ERR, errorHandler } from "@edgway/errors";
import { Hono } from "hono";
import { CompactSign, exportJWK, generateKeyPair } from "jose";
import { describe, expect, it, vi } from "vitest";
import {
  createDataPlane,
  createSecretResolver,
  type DataPlaneEnv,
  isVaultReference,
  type PluginFactory,
  resolveSnapshotSecrets,
  type Snapshot,
} from "../src/index";
import { isVaultReference as fromSubpath } from "../src/secrets/reference";

const secretsEnv = {
  VAULT_JWT_SECRET: "s3cret",
  VAULT_OIDC: JSON.stringify({ client_secret: "from-json" }),
  // The Worker's own secrets and vars: never readable through a reference.
  JWT_SECRET: "unprefixed",
  CONFIG_SIGNING_KEY: "the-admin-key",
  VAULT_STORED: { get: async () => "from-store" },
  VAULT_STORED_JSON: { get: async () => JSON.stringify({ token: "t-1" }) },
  // A Secrets Store binding without the prefix, and another binding with a
  // get() method (KV-like): never read through a reference.
  STORED: { get: async () => "unprefixed-store" },
  NOT_A_VAULT: { get: async () => "kv-value" },
  // A Secrets Store read that fails once (an outage), then succeeds.
  VAULT_FLAKY: {
    calls: 0,
    async get() {
      this.calls += 1;
      if (this.calls === 1) throw new Error("store unavailable");
      return "recovered";
    },
  },
  NOT_A_SECRET: { put: () => {} },
};
const resolver = createSecretResolver(secretsEnv);

describe("createSecretResolver (env and Secrets Store vaults)", () => {
  it("reads a secret by Kong's name mapping", async () => {
    expect(await resolver.resolve("{vault://env/vault-jwt-secret}")).toBe(
      "s3cret",
    );
    expect(await resolver.resolve("{vault://env/VAULT_JWT_SECRET}")).toBe(
      "s3cret",
    );
  });

  it("reads one field of a JSON secret", async () => {
    expect(
      await resolver.resolve("{vault://env/vault-oidc/client_secret}"),
    ).toBe("from-json");
  });

  it("reads Secrets Store bindings through {vault://cf-secrets-store/NAME}", async () => {
    expect(
      await resolver.resolve("{vault://cf-secrets-store/VAULT_STORED}"),
    ).toBe("from-store");
    expect(
      await resolver.resolve("{vault://cf-secrets-store/vault-stored}"),
    ).toBe("from-store");
    expect(
      await resolver.resolve(
        "{vault://cf-secrets-store/VAULT_STORED_JSON/token}",
      ),
    ).toBe("t-1");
    // Each vault reads only its own kind of binding.
    await expect(
      resolver.resolve("{vault://cf-secrets-store/VAULT_JWT_SECRET}"),
    ).rejects.toThrow();
    await expect(resolver.resolve("{vault://env/stored}")).rejects.toThrow();
  });

  it("reads only env names starting with VAULT_", async () => {
    for (const reference of [
      "{vault://env/jwt-secret}",
      "{vault://env/JWT_SECRET}",
      "{vault://env/config-signing-key}",
      "{vault://env/CONFIG_SIGNING_KEY}",
    ]) {
      await expect(resolver.resolve(reference)).rejects.toThrow();
    }
    expect(VAULTS.namePrefix).toBe("VAULT_");
  });

  it("reads only Secrets Store bindings named VAULT_*", async () => {
    for (const reference of [
      "{vault://cf-secrets-store/STORED}",
      "{vault://cf-secrets-store/not-a-vault}",
      "{vault://cf-secrets-store/NOT_A_VAULT}",
    ]) {
      await expect(resolver.resolve(reference)).rejects.toThrow();
    }
  });

  it("refuses what it can't resolve", async () => {
    for (const reference of [
      "{vault://env/missing}",
      "{vault://env/not-a-secret}",
      "{vault://env/vault-oidc/absent}",
      "{vault://env/vault-jwt-secret/field}",
      "{vault://aws/jwt-secret}",
      "not-a-reference",
    ]) {
      await expect(resolver.resolve(reference)).rejects.toThrow();
    }
    expect(resolver.isReference("{vault://env/x}")).toBe(true);
    // One home: the subpath admin-core imports is the same check.
    expect(isVaultReference).toBe(fromSubpath);
    expect(resolver.isReference("plain")).toBe(false);
  });
});

const keys = await generateKeyPair("EdDSA", { extractable: true });
const bindings = {
  CONFIG_KV: env.CONFIG_KV,
  CONFIG_PUBLIC_KEY: JSON.stringify(await exportJWK(keys.publicKey)),
  ...secretsEnv,
};

let version = 100;
async function publish(config: Snapshot) {
  version += 1;
  const snapshot = JSON.stringify(config);
  const manifest = await new CompactSign(
    new TextEncoder().encode(
      JSON.stringify({ version, sha256: await sha256Hex(snapshot) }),
    ),
  )
    .setProtectedHeader({ alg: "EdDSA" })
    .sign(keys.privateKey);
  await env.CONFIG_KV.put(
    KV_KEY.configVersion(version),
    JSON.stringify({ manifest, snapshot }),
  );
  await env.CONFIG_KV.put(KV_KEY.configCurrent, JSON.stringify({ version }));
}

/** A plugin that answers with its (resolved) config. */
const echo: PluginFactory = {
  name: "echo-config",
  instance: ({ id, scope, config }) => ({
    id,
    name: "echo-config",
    priority: 10,
    scope,
    handlers: { access: async (c) => c.json(config) },
  }),
};

/** The paths publish allows references in, for these tests' configs. */
const ALLOWED = [
  ["client_secret", VAULTS.anyItem],
  ["nested", "header_value"],
];

const snapshot = (
  config: Record<string, unknown>,
  vault_paths: string[][] | undefined = ALLOWED,
): Snapshot => ({
  services: [{ id: "svc", protocol: "https", host: "api.example", port: 443 }],
  routes: [{ id: "r", service_id: "svc", paths: ["/s"] }],
  consumers: [{ id: "c1", username: "alice" }],
  plugins: [
    { id: "p", name: "echo-config", route_id: "r", config, vault_paths },
  ],
  jwt_secrets: [
    {
      id: "j1",
      consumer_id: "c1",
      key: "iss-1",
      secret: "{vault://env/vault-jwt-secret}",
    },
    { id: "j2", consumer_id: "c1", key: "iss-2", secret: "{vault://env/gone}" },
  ],
});

function gateway(seen: Snapshot[]) {
  const app = new Hono<{ Bindings: DataPlaneEnv }>();
  app.all(
    "*",
    createDataPlane<DataPlaneEnv>({
      plugins: [echo],
      setup: (s) => {
        seen.push(s);
        return async (_c, next) => next();
      },
    }),
  );
  app.onError(errorHandler());
  return async (path: string) => {
    const ctx = createExecutionContext();
    const res = await app.request(path, {}, bindings, ctx);
    await waitOnExecutionContext(ctx);
    return res;
  };
}

describe("the data plane resolves vault references", () => {
  it("in plugin configs and jwt secrets, never using the reference itself", async () => {
    await publish(
      snapshot({
        client_secret: ["{vault://env/vault-oidc/client_secret}"],
        nested: { header_value: "{vault://cf-secrets-store/VAULT_STORED}" },
        plain: "kept",
      }),
    );
    const seen: Snapshot[] = [];
    const res = await gateway(seen)("https://gw.test/s");
    expect(await res.json()).toEqual({
      client_secret: ["from-json"],
      nested: { header_value: "from-store" },
      plain: "kept",
    });
    // The stores get resolved secrets; an unresolvable one is dropped.
    expect(seen[0]?.jwt_secrets?.map((j) => j.secret)).toEqual([
      "s3cret",
      null,
    ]);
  });

  it("resolves a reference only at a path publish allowed", async () => {
    // A reference in a field that isn't referenceable (a response body), as
    // a config signed before an earlier release could hold, or one rolled back to.
    for (const vault_paths of [ALLOWED, undefined]) {
      await publish(
        snapshot({ body: "{vault://env/vault-jwt-secret}" }, vault_paths),
      );
      const res = await gateway([])("https://gw.test/s");
      expect(res.status).toBe(ERR.PLUGIN_UNAVAILABLE.status);
      expect(await res.text()).not.toContain("s3cret");
    }
  });

  it("fails closed on a plugin whose secret can't be resolved", async () => {
    await publish(snapshot({ client_secret: ["{vault://env/missing}"] }));
    const res = await gateway([])("https://gw.test/s");
    expect(res.status).toBe(ERR.PLUGIN_UNAVAILABLE.status);
    expect(await res.json()).toMatchObject({
      code: ERR.PLUGIN_UNAVAILABLE.code,
    });
  });

  it("retries an unresolved secret after VAULTS.retryMs, not only on the next publish", async () => {
    await publish(
      snapshot({ client_secret: ["{vault://cf-secrets-store/VAULT_FLAKY}"] }),
    );
    const call = gateway([]);
    expect((await call("https://gw.test/s")).status).toBe(
      ERR.PLUGIN_UNAVAILABLE.status,
    );
    // Within the window, still the failed build.
    expect((await call("https://gw.test/s")).status).toBe(
      ERR.PLUGIN_UNAVAILABLE.status,
    );
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Date.now() + VAULTS.retryMs + 1);
      const res = await call("https://gw.test/s");
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ client_secret: ["recovered"] });
    } finally {
      vi.useRealTimers();
    }
  });

  it("resolveSnapshotSecrets leaves a snapshot without references alone", async () => {
    const plain: Snapshot = {
      services: [],
      routes: [],
      consumers: [],
      plugins: [{ id: "p", name: "x", config: { a: 1 } }],
    };
    expect(await resolveSnapshotSecrets(plain, resolver)).toEqual({
      snapshot: plain,
      complete: true,
    });
  });
});
