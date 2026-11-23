/**
 * Credential and consumer lookups for the auth plugins (key-auth, jwt,
 * basic-auth, openid-connect, acl), served from the published snapshot:
 * indexed once per snapshot, never read from D1 on the request path. The
 * shapes are structural: they satisfy each plugin's store interface without
 * this package depending on the plugins.
 */

/** Kong's `consumers` row, as the snapshot carries it. */
export interface SnapshotConsumer {
  id: string;
  username?: string | null;
  custom_id?: string | null;
}

/** The snapshot tables the stores read (Kong's table and field names). */
export interface SnapshotCredentials {
  consumers: readonly SnapshotConsumer[];
  keyauth_credentials?: readonly {
    id: string;
    consumer_id: string;
    /** SHA-256 hex of the key; the raw key is never stored. */
    key_hash: string;
    /** Epoch seconds; an expired key never matches. */
    expires_at?: number | null;
  }[];
  jwt_secrets?: readonly {
    id: string;
    consumer_id: string;
    key: string;
    algorithm?: string | null;
    secret?: string | null;
    rsa_public_key?: string | null;
  }[];
  basicauth_credentials?: readonly {
    id: string;
    consumer_id: string;
    username: string;
    password: string;
  }[];
  acls?: readonly { consumer_id: string; group: string }[];
  consumer_groups?: readonly { id: string; name: string }[];
  consumer_group_consumers?: readonly {
    consumer_group_id: string;
    consumer_id: string;
  }[];
}

/** Rows indexed by one field. */
const index = <T, K>(rows: readonly T[] | undefined, key: (row: T) => K) =>
  new Map((rows ?? []).map((row) => [key(row), row] as const));

/** Values grouped by one field. */
function group<T>(
  rows: readonly T[] | undefined,
  key: (row: T) => string,
  value: (row: T) => string | undefined,
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const row of rows ?? []) {
    const v = value(row);
    if (v === undefined) continue;
    out.set(key(row), [...(out.get(key(row)) ?? []), v]);
  }
  return out;
}

const plain = (consumer: SnapshotConsumer | undefined) =>
  consumer && {
    id: consumer.id,
    username: consumer.username ?? undefined,
    custom_id: consumer.custom_id ?? undefined,
  };

/** Every auth plugin's store over one snapshot. */
export function snapshotStores(snapshot: SnapshotCredentials) {
  const byId = index(snapshot.consumers, (c) => c.id);
  const byUsername = index(
    snapshot.consumers.filter((c) => c.username),
    (c) => c.username,
  );
  const byCustomId = index(
    snapshot.consumers.filter((c) => c.custom_id),
    (c) => c.custom_id,
  );
  /** Kong's anonymous and credential-owner lookup: id first, then username. */
  const consumer = (idOrUsername: string) =>
    plain(byId.get(idOrUsername) ?? byUsername.get(idOrUsername));

  const keys = index(snapshot.keyauth_credentials, (k) => k.key_hash);
  const jwts = index(snapshot.jwt_secrets, (j) => j.key);
  const basics = index(snapshot.basicauth_credentials, (b) => b.username);
  const groupNames = index(snapshot.consumer_groups, (g) => g.id);
  const acls = group(
    snapshot.acls,
    (a) => a.consumer_id,
    (a) => a.group,
  );
  const memberships = group(
    snapshot.consumer_group_consumers,
    (m) => m.consumer_id,
    (m) => groupNames.get(m.consumer_group_id)?.name,
  );

  return {
    keyAuth: { credential: (hash: string) => keys.get(hash), consumer },
    jwt: { credential: (key: string) => jwts.get(key), consumer },
    basicAuth: {
      credential: (username: string) => basics.get(username),
      consumer,
    },
    oidc: {
      consumer: (by: "id" | "username" | "custom_id", value: string) =>
        plain(
          (by === "id"
            ? byId
            : by === "username"
              ? byUsername
              : byCustomId
          ).get(value),
        ),
    },
    acl: {
      groups: (consumerId: string) => acls.get(consumerId) ?? [],
      consumerGroups: (consumerId: string) => memberships.get(consumerId) ?? [],
    },
  };
}
