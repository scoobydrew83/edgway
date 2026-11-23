import { env } from "cloudflare:test";
import { CONFIG, KV_KEY } from "@edgway/constants";
import { CompactSign, importJWK, type JWK } from "jose";

// Publish the demo snapshot as the admin would: signed manifest, KV.
const version = 1;
const snapshot = env.TEST_SNAPSHOT;
const key = await importJWK(JSON.parse(env.TEST_SIGNING_KEY) as JWK, "EdDSA");
const manifest = await new CompactSign(
  new TextEncoder().encode(
    JSON.stringify({ version, sha256: env.TEST_SNAPSHOT_SHA256 }),
  ),
)
  .setProtectedHeader({ alg: "EdDSA" })
  .sign(key);
await env.CONFIG_KV.put(
  KV_KEY.configVersion(version),
  JSON.stringify({ manifest, snapshot }),
);
await env.CONFIG_KV.put(KV_KEY.configCurrent, JSON.stringify({ version }));
// The live version is the ConfigVersion DO's (the stand-in admin
// worker), moved here directly: the gateway's own binding only reads.
const namespace = env.TEST_CONFIG_VERSION;
if (namespace) {
  const versions = namespace.get(
    namespace.idFromName(CONFIG.versionObjectName),
  );
  const live = await versions.current();
  if (live !== version) await versions.compareAndSet(live, version);
}
