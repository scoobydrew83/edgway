/**
 * Deploys Edgway to the Cloudflare account wrangler is logged in to (or
 * CLOUDFLARE_API_TOKEN): `edgway deploy`, and `pnpm run deploy` through it
 * (one implementation). Every step is idempotent:
 *
 *   1. One KV namespace for published snapshots, shared by the admin and the
 *      gateway, and the admin's D1 database: found by name or created, and
 *      their ids written into the wrangler configs with wrangler's own config
 *      API (comments kept). Not wrangler's automatic provisioning: it gives
 *      each Worker its own KV namespace, and it creates D1 during `wrangler
 *      deploy`, so on a first deploy the admin would serve before its
 *      migrations ran.
 *   2. The admin's D1 migrations, applied remotely.
 *   3. `wrangler deploy` for the admin, the gateway, then the developer portal.
 *      The admin and the gateway bind each other (the gateway the admin's
 *      ConfigVersionReader, the admin the gateway as GATEWAY), so the admin
 *      goes first without its GATEWAY binding and again with it last.
 *   4. On the first deploy, two Ed25519 pairs as Worker secrets: the snapshot
 *      pair (the admin signs, the gateway verifies) and the route tester's
 *      trace pair. Only the admin signs. Secrets never go in vars or
 *      D1 (CLAUDE.md §4). An install from before an earlier release has the snapshot key
 *      taken off the portal.
 *
 * `dryRun` touches nothing remote: it bundles and checks the three Workers.
 */
import { webcrypto } from "node:crypto";
import { rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CLI } from "@edgway/constants";
import {
  cliDeployBound,
  cliDeployKeysPartial,
  cliDeployNoBinding,
  cliDeployStep,
  t,
} from "@edgway/i18n";
import { commandLine, wranglerSync } from "./wrangler";

export interface DeployOptions {
  /** The project directory. */
  root: string;
  /** The three Workers' wrangler configs. */
  admin: string;
  gateway: string;
  portal: string;
  dryRun?: boolean;
}

type Binding = Record<string, unknown> & { binding?: string };
type Entry = Record<string, string>;

/** The first JSON value in wrangler's output (it may print a banner first). */
function json<T>(output: string): T {
  return JSON.parse(output.slice(output.search(/[[{]/))) as T;
}

export async function deployEdgway(options: DeployOptions): Promise<void> {
  const { root, admin, gateway, portal, dryRun = false } = options;
  const run = (
    args: string[],
    { cwd = root, capture = false, input }: RunOptions = {},
  ) => {
    console.log(t(cliDeployStep, { command: commandLine(args) }));
    return wranglerSync(args, { cwd, capture, input });
  };
  const deploy = (config: string, ...extra: string[]) =>
    run(["deploy", ...extra, "--config", config], {
      cwd: path.dirname(config),
    });

  if (dryRun) {
    for (const config of [admin, gateway, portal]) deploy(config, "--dry-run");
    return;
  }

  // Loaded here only: importing wrangler routes the whole process's fetch
  // through an HTTP(S)_PROXY if one is set, which the other commands avoid.
  const { experimental_readRawConfig: readRaw, experimental_patchConfig } =
    await import("wrangler");
  const raw = (file: string) =>
    readRaw({ config: file }).rawConfig as Record<string, unknown>;
  const bindings = (file: string, kind: string) =>
    (raw(file)[kind] as Binding[] | undefined) ?? [];
  const bound = (file: string, kind: string, binding: string, field: string) =>
    bindings(file, kind).find((b) => b.binding === binding)?.[field] as
      | string
      | undefined;

  /** Sets a field of the `binding` entry under `kind`, in place. */
  function bind(
    file: string,
    kind: string,
    binding: string,
    field: string,
    id: string,
  ) {
    const entries = bindings(file, kind);
    const index = entries.findIndex((b) => b.binding === binding);
    if (index < 0) throw new Error(t(cliDeployNoBinding, { file, binding }));
    if (entries[index]?.[field] === id) return;
    experimental_patchConfig(
      file,
      {
        [kind]: entries.map((b, i) =>
          i === index ? { ...b, [field]: id } : b,
        ),
      },
      false,
    );
    console.log(
      t(cliDeployBound, {
        file: path.relative(root, file),
        binding,
        field,
        id,
      }),
    );
  }

  function provisionKv(): string {
    const known = bound(admin, "kv_namespaces", CLI.kvBinding, "id");
    if (known) return known;
    const find = () =>
      json<Entry[]>(run(["kv", "namespace", "list"], { capture: true })).find(
        (ns) => ns.title === CLI.kvTitle,
      )?.id;
    const existing = find();
    if (existing) return existing;
    run(["kv", "namespace", "create", CLI.kvTitle]);
    return find() ?? "";
  }

  function provisionD1(): string {
    const db = CLI.adminDatabaseBinding;
    const known = bound(admin, "d1_databases", db, "database_id");
    if (known) return known;
    const name = bound(admin, "d1_databases", db, "database_name") ?? "";
    const find = () =>
      json<Entry[]>(run(["d1", "list", "--json"], { capture: true })).find(
        (entry) => entry.name === name,
      )?.uuid;
    const existing = find();
    if (existing) return existing;
    run(["d1", "create", name]);
    return find() ?? "";
  }

  const secretNames = (config: string) =>
    json<Entry[]>(
      run(["secret", "list", "--format", "json", "--config", config], {
        capture: true,
      }),
    ).map((s) => s.name);

  /**
   * An Ed25519 pair as Worker secrets: the private half on `privateOn`, the
   * public half on `publicOn`. Created only when none of the secrets exist;
   * a partial set stops the deploy, since a new pair would invalidate what
   * the old one signed.
   */
  async function keyPair(pair: {
    privateName: string;
    privateOn: string;
    publicName: string;
    publicOn: string;
  }) {
    const present = [
      [pair.privateOn, pair.privateName],
      [pair.publicOn, pair.publicName],
    ].map(([config = "", name = ""]) => ({
      label: `${path.relative(root, config)}#${name}`,
      set: secretNames(config).includes(name),
    }));
    if (present.every((p) => p.set)) return;
    if (present.some((p) => p.set)) {
      const missing = present.filter((p) => !p.set).map((p) => p.label);
      throw new Error(t(cliDeployKeysPartial, { missing: missing.join(", ") }));
    }
    const { subtle } = webcrypto;
    const keys = (await subtle.generateKey({ name: "Ed25519" }, true, [
      "sign",
      "verify",
    ])) as webcrypto.CryptoKeyPair;
    const jwk = async (key: webcrypto.CryptoKey) =>
      JSON.stringify(await subtle.exportKey("jwk", key));
    run(["secret", "put", pair.privateName, "--config", pair.privateOn], {
      input: await jwk(keys.privateKey),
    });
    run(["secret", "put", pair.publicName, "--config", pair.publicOn], {
      input: await jwk(keys.publicKey),
    });
  }

  const kv = provisionKv();
  bind(admin, "kv_namespaces", CLI.kvBinding, "id", kv);
  bind(gateway, "kv_namespaces", CLI.kvBinding, "id", kv);
  const db = provisionD1();
  bind(admin, "d1_databases", CLI.adminDatabaseBinding, "database_id", db);
  bind(portal, "d1_databases", CLI.adminDatabaseBinding, "database_id", db);
  run(
    [
      "d1",
      "migrations",
      "apply",
      CLI.adminDatabaseBinding,
      "--remote",
      "--config",
      admin,
    ],
    { cwd: path.dirname(admin) },
  );
  // The admin without its GATEWAY binding: a Worker can't bind one that
  // doesn't exist yet. Written beside the original (its relative paths
  // hold), removed once deployed.
  const bootstrap = path.join(path.dirname(admin), CLI.bootstrapConfig);
  writeFileSync(bootstrap, JSON.stringify({ ...raw(admin), services: [] }));
  try {
    deploy(bootstrap);
  } finally {
    rmSync(bootstrap, { force: true });
  }
  for (const config of [gateway, portal, admin]) deploy(config);
  await keyPair({
    privateName: CLI.secrets.snapshotSigning,
    privateOn: admin,
    publicName: CLI.secrets.snapshotPublic,
    publicOn: gateway,
  });
  await keyPair({
    privateName: CLI.secrets.traceSigning,
    privateOn: admin,
    publicName: CLI.secrets.tracePublic,
    publicOn: gateway,
  });
  // Installs from before an earlier release gave the portal the snapshot signing key.
  if (secretNames(portal).includes(CLI.secrets.snapshotSigning)) {
    run(
      ["secret", "delete", CLI.secrets.snapshotSigning, "--config", portal],
      // Confirms wrangler's prompt.
      { cwd: path.dirname(portal), input: "y\n" },
    );
  }
}

interface RunOptions {
  cwd?: string;
  capture?: boolean;
  input?: string;
}
