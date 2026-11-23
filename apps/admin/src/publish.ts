/**
 * The publish target for this Worker: the config KV, the ConfigVersion
 * Durable Object, and the snapshot signing key from the `CONFIG_SIGNING_KEY`
 * secret (an Ed25519 private JWK) with its public half. Without the secret,
 * publishing is off.
 */
import type { ConfigVersion } from "@edgway/adapters-cf";
import {
  importSigningKeys,
  type PublishTarget,
  type VersionSource,
} from "@edgway/admin-core";
import { ERR, fail } from "@edgway/errors";
import type { Context } from "hono";

export interface PublishEnv {
  CONFIG_KV: KVNamespace;
  CONFIG_VERSION?: DurableObjectNamespace<ConfigVersion>;
  /** Secret: the Ed25519 private JWK that signs snapshot manifests. */
  CONFIG_SIGNING_KEY?: string;
}

export const publishTarget = (c: Context) =>
  publishTargetOf(c.env as PublishEnv);

/** The publish target from the Worker's env (also the portal batch's). */
export async function publishTargetOf(env: PublishEnv): Promise<PublishTarget> {
  const secret = env.CONFIG_SIGNING_KEY;
  if (!secret) {
    fail(ERR.ADMIN_PUBLISH_DISABLED, { detail: "CONFIG_SIGNING_KEY" });
  }
  return {
    kv: env.CONFIG_KV,
    ...(await importSigningKeys(secret)),
    versions: env.CONFIG_VERSION,
  };
}

/** Where this Worker reads the live version: the DO when bound. */
export function versionSource(c: Context): VersionSource {
  const env = c.env as PublishEnv;
  return { kv: env.CONFIG_KV, versions: env.CONFIG_VERSION };
}
