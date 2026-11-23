/**
 * Core's `SecretResolver` for the vaults the PRD names:
 * - Kong's `env` vault: `{vault://env/vault-my-secret}` reads the Worker's
 *   VAULT_MY_SECRET (Kong's mapping: upper case, dashes to underscores), a
 *   secret or var. Only names starting with `VAULT_` resolve,
 *   so a reference can never read the Worker's own secrets or vars;
 * - Cloudflare Secrets Store: `{vault://cf-secrets-store/VAULT_NAME}` reads
 *   the Secrets Store binding VAULT_NAME (as written, or with the same
 *   mapping) with `get()`; only bindings named `VAULT_*`.
 * Either takes a `/field` suffix to read one field of a JSON secret. Anything
 * else (another vault, a missing secret, a binding that isn't one) throws:
 * callers fail closed.
 *
 * `resolveSnapshotSecrets` applies it to a snapshot before the data plane
 * uses it: jwt secrets and every vault reference in plugin configs.
 */
import { VAULT_REFERENCE, VAULTS } from "@edgway/constants";
import type { SecretResolver } from "@edgway/core";
import { isVaultReference } from "./reference.js";

export { isVaultReference };

/** A Secrets Store binding (`secrets_store_secrets`). */
interface StoredSecret {
  get(): Promise<string>;
}

/** Thrown when a reference can't be resolved. */
export class UnresolvedSecret extends Error {
  override name = "UnresolvedSecret";
}

export function createSecretResolver(
  env: Readonly<Record<string, unknown>>,
): SecretResolver {
  return {
    isReference: isVaultReference,
    async resolve(reference) {
      if (!isVaultReference(reference)) throw new UnresolvedSecret(reference);
      const path = reference.slice(
        VAULT_REFERENCE.prefix.length,
        -VAULT_REFERENCE.suffix.length,
      );
      const [vault, name, field, ...rest] = path.split(VAULTS.separator);
      if (!name || rest.length > 0) throw new UnresolvedSecret(reference);
      const mapped = name.toUpperCase().replaceAll("-", "_");
      let value: string | undefined;
      if (vault === VAULTS.env) {
        // The env vault's allow-list.
        const found = mapped.startsWith(VAULTS.namePrefix)
          ? env[mapped]
          : undefined;
        value = typeof found === "string" ? found : undefined;
      } else if (vault === VAULTS.secretsStore) {
        // The same allow-list: only bindings named VAULT_*, so a
        // reference can't call `get()` on another binding.
        const binding = [name, mapped].find((n) =>
          n.startsWith(VAULTS.namePrefix),
        );
        const found = (binding ? env[binding] : undefined) as
          | StoredSecret
          | undefined;
        value =
          typeof found?.get === "function" ? await found.get() : undefined;
      }
      if (value === undefined) throw new UnresolvedSecret(reference);
      if (field === undefined) return value;
      let parsed: unknown;
      try {
        parsed = JSON.parse(value);
      } catch {
        throw new UnresolvedSecret(reference);
      }
      const picked = (parsed as Record<string, unknown> | null)?.[field];
      if (typeof picked !== "string") throw new UnresolvedSecret(reference);
      return picked;
    },
  };
}

/**
 * Every vault reference in a value, resolved (recursively) where `allowed`
 * holds its path (array items as `VAULTS.anyItem`); a reference anywhere
 * else is never resolved. Without `allowed`, any path is.
 */
async function resolveDeep(
  value: unknown,
  resolver: SecretResolver,
  allowed?: ReadonlySet<string>,
  path: readonly string[] = [],
): Promise<unknown> {
  if (isVaultReference(value)) {
    if (allowed && !allowed.has(JSON.stringify(path))) {
      throw new UnresolvedSecret(value);
    }
    return await resolver.resolve(value);
  }
  if (Array.isArray(value)) {
    return await Promise.all(
      value.map((v) =>
        resolveDeep(v, resolver, allowed, [...path, VAULTS.anyItem]),
      ),
    );
  }
  if (value && typeof value === "object") {
    const entries = await Promise.all(
      Object.entries(value).map(
        async ([k, v]) =>
          [k, await resolveDeep(v, resolver, allowed, [...path, k])] as const,
      ),
    );
    return Object.fromEntries(entries);
  }
  return value;
}

/** What the resolver reads from a snapshot (data-plane's `Snapshot`). */
interface SecretTables {
  plugins: readonly {
    config: Record<string, unknown>;
    vault_paths?: readonly (readonly string[])[];
  }[];
  jwt_secrets?: readonly { secret?: string | null }[];
}

/** A plugin whose config names a secret that can't be resolved. */
export type UnresolvedPlugin<P> = P & { unresolved: true };

/**
 * The snapshot with its secrets resolved. A jwt credential whose secret
 * can't be resolved loses it (its tokens are refused); a plugin whose config
 * can't be resolved is marked `unresolved` (its routes fail closed).
 * `complete` is false when anything was left unresolved.
 */
export async function resolveSnapshotSecrets<S extends SecretTables>(
  snapshot: S,
  resolver: SecretResolver,
): Promise<{ snapshot: S; complete: boolean }> {
  let complete = true;
  const attempt = async <T>(
    value: T,
    allowed?: ReadonlySet<string>,
  ): Promise<T | undefined> => {
    try {
      return (await resolveDeep(value, resolver, allowed)) as T;
    } catch {
      complete = false;
      return undefined;
    }
  };
  const [plugins, jwts] = await Promise.all([
    Promise.all(
      snapshot.plugins.map(async (p) => {
        // Only at the paths publish allowed: none for a config
        // signed before them, so its references fail closed.
        const allowed = new Set(
          (p.vault_paths ?? []).map((path) => JSON.stringify(path)),
        );
        const config = await attempt(p.config, allowed);
        return config === undefined
          ? ({ ...p, unresolved: true } as UnresolvedPlugin<typeof p>)
          : { ...p, config };
      }),
    ),
    snapshot.jwt_secrets &&
      Promise.all(
        snapshot.jwt_secrets.map(async (j) => ({
          ...j,
          secret: isVaultReference(j.secret)
            ? ((await attempt(j.secret)) ?? null)
            : j.secret,
        })),
      ),
  ]);
  return {
    snapshot: { ...snapshot, plugins, ...(jwts ? { jwt_secrets: jwts } : {}) },
    complete,
  };
}
