/** Each command, through the built CLI, against a local admin Worker. */
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { CLI, HEADER } from "@edgway/constants";
import { sha256Hex } from "@edgway/core";
import { ERR } from "@edgway/errors";
import { exportJWK, generateKeyPair, type JWK, SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { experimental_readRawConfig, unstable_startWorker } from "wrangler";
import { adminWithoutServices } from "../../../tools/wrangler-config.mjs";
import { accessHeaders } from "../src/admin";

const run = promisify(execFile);
const repo = path.resolve(import.meta.dirname, "../../..");
const bin = path.join(import.meta.dirname, "../dist/index.js");
const adminConfig = path.join(repo, CLI.adminConfig);

const TEAM = "edgway-cli-test";
const AUD = "edgway-cli-aud";
const EMAIL = "cli@example.com";

/** Runs `edgway <args>`; resolves with its exit code and output. */
async function edgway(args: string[], cwd: string) {
  try {
    const { stdout, stderr } = await run(process.execPath, [bin, ...args], {
      cwd,
      env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
      maxBuffer: 16 * 1024 * 1024,
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const e = error as { code: number; stdout: string; stderr: string };
    return { code: e.code, stdout: e.stdout, stderr: e.stderr };
  }
}

let project: string;
let persist: string;
let admin: Awaited<ReturnType<typeof unstable_startWorker>> | undefined;
let adminUrl: string;
let token: string;
/** The Kong-Admin-Token the admin accepts (publisher), for import-deck --remote. */
const KONG_TOKEN = "edgway-cli-kong-token";

beforeAll(async () => {
  project = mkdtempSync(path.join(tmpdir(), "edgway-cli-"));
  persist = path.join(project, "state");
  // The project's config points at this repo's two Workers.
  writeFileSync(
    path.join(project, CLI.configFile),
    `export default ${JSON.stringify({
      admin: { config: adminConfig },
      gateway: { config: path.join(repo, CLI.gatewayConfig) },
      portal: { config: path.join(repo, CLI.portalConfig) },
    })};\n`,
  );
});

afterAll(async () => {
  await admin?.dispose();
});

describe("edgway", () => {
  it("prints help", async () => {
    const { code, stdout } = await edgway(["--help"], project);
    expect(code).toBe(0);
    for (const command of [
      "init",
      "deploy",
      "import-deck",
      "diff",
      "publish",
      "plugin",
    ]) {
      expect(stdout).toContain(command);
    }
  });

  it("prints its version", async () => {
    const { code, stdout } = await edgway(["--version"], project);
    expect(code).toBe(0);
    const pkg = JSON.parse(
      readFileSync(path.join(import.meta.dirname, "../package.json"), "utf8"),
    ) as { version: string };
    expect(stdout.trim()).toBe(pkg.version);
  });

  it("prints an error's message only, and its stack with --debug", async () => {
    const plain = await edgway(["rollback", "latest"], project);
    expect(plain.code).toBe(1);
    expect(plain.stderr).toContain("positive whole number");
    expect(plain.stderr).toContain("--debug");
    expect(plain.stderr).not.toMatch(/^\s+at /m);
    const debug = await edgway(["rollback", "latest", "--debug"], project);
    expect(debug.code).toBe(1);
    expect(debug.stderr).toMatch(/^\s+at /m);
  });

  it("sends a deployed admin cf-access-token, a local one the assertion", () => {
    const env = {};
    expect(
      accessHeaders("https://admin.example.com", { token: "t" }, env),
    ).toEqual({ [HEADER.cfAccessToken]: "t" });
    expect(accessHeaders("http://127.0.0.1:8787", { token: "t" }, env)).toEqual(
      { [HEADER.cfAccessJwtAssertion]: "t" },
    );
    expect(
      accessHeaders(
        "https://admin.example.com",
        {},
        {
          [CLI.env.accessClientId]: "id",
          [CLI.env.accessClientSecret]: "secret",
        },
      ),
    ).toEqual({
      [HEADER.cfAccessClientId]: "id",
      [HEADER.cfAccessClientSecret]: "secret",
    });
  });

  it("init doesn't prompt without a terminal", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "edgway-init-notty-"));
    // execFile gives the CLI no TTY: no --yes needed.
    const res = await edgway(
      ["init", "--admin-url", "https://admin.example.com"],
      dir,
    );
    expect(res.code).toBe(0);
    const source = readFileSync(path.join(dir, CLI.configFile), "utf8");
    expect(source).toContain(CLI.portalConfig);
  });

  it("init writes edgway.config.ts, and won't overwrite it without --force", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "edgway-init-"));
    const first = await edgway(
      ["init", "--yes", "--admin-url", "https://admin.example.com"],
      dir,
    );
    expect(first.code).toBe(0);
    const source = readFileSync(path.join(dir, CLI.configFile), "utf8");
    expect(source).toContain("https://admin.example.com");
    expect(source).toContain(CLI.adminConfig);
    const again = await edgway(["init", "--yes"], dir);
    expect(again.code).not.toBe(0);
    expect(again.stderr).toContain(CLI.configFile);
    expect((await edgway(["init", "--yes", "--force"], dir)).code).toBe(0);
  });

  it("plugin new scaffolds a package and refuses bad names", async () => {
    const { code } = await edgway(["plugin", "new", "hello-world"], project);
    expect(code).toBe(0);
    const dir = path.join(project, CLI.pluginDir, "hello-world");
    const pkg = JSON.parse(
      readFileSync(path.join(dir, "package.json"), "utf8"),
    );
    expect(pkg.name).toBe("@edgway/plugin-hello-world");
    expect(readFileSync(path.join(dir, "src/index.ts"), "utf8")).toContain(
      'name: "hello-world"',
    );
    expect(existsSync(path.join(dir, "test/hello-world.test.ts"))).toBe(true);
    expect(
      (await edgway(["plugin", "new", "Bad_Name"], project)).code,
    ).not.toBe(0);
    expect(
      (await edgway(["plugin", "new", "hello-world"], project)).code,
    ).not.toBe(0);
  });

  it("import-deck imports demo.yaml into the local D1, idempotently", async () => {
    const file = path.join(repo, "examples/deck/demo.yaml");
    const args = ["import-deck", file, "--persist-to", persist];
    const first = await edgway(args, project);
    expect(first.code).toBe(0);
    // No entity was refused (wrangler may still print its own warnings).
    expect(first.stderr).not.toMatch(/^(service|route|plugin|consumer)/m);
    expect(first.stdout).toContain("10 entities");
    // Upserts by name: a second import changes nothing (checked by diff below).
    expect((await edgway(args, project)).code).toBe(0);
  });

  it("import-deck rejects a file that isn't valid decK", async () => {
    const bad = path.join(project, "bad.yaml");
    writeFileSync(bad, "services: 42\n");
    const res = await edgway(
      ["import-deck", bad, "--persist-to", persist],
      project,
    );
    expect(res.code).not.toBe(0);
    expect(res.stderr).toContain("bad.yaml");
  });

  it("diff and publish against the admin", async () => {
    // The admin Worker on the same local state, behind a stubbed Access team.
    const access = await generateKeyPair("RS256", { extractable: true });
    const signing = await generateKeyPair("EdDSA", { extractable: true });
    const publicJwk: JWK = {
      ...(await exportJWK(access.publicKey)),
      kid: "test",
      alg: "RS256",
      use: "sig",
    };
    admin = await unstable_startWorker({
      // Without the GATEWAY binding, which can't resolve under
      // unstable_startWorker.
      config: adminWithoutServices({
        readRawConfig: experimental_readRawConfig,
        config: adminConfig,
        file: path.join(persist, "admin.wrangler.json"),
      }),
      bindings: {
        ACCESS_TEAM: { type: "plain_text", value: TEAM },
        ACCESS_AUD: { type: "plain_text", value: AUD },
        ADMIN_ROLES: {
          type: "plain_text",
          value: JSON.stringify({ [EMAIL]: "publisher" }),
        },
        CONFIG_SIGNING_KEY: {
          type: "plain_text",
          value: JSON.stringify(await exportJWK(signing.privateKey)),
        },
        KONG_ADMIN_TOKENS: {
          type: "plain_text",
          value: JSON.stringify({ [await sha256Hex(KONG_TOKEN)]: "publisher" }),
        },
      },
      dev: {
        persist,
        server: { hostname: "127.0.0.1", port: 0 },
        inspector: false,
        watch: false,
        logLevel: "none",
        outboundService: async (request: Request) => {
          if (
            new URL(request.url).hostname === `${TEAM}.cloudflareaccess.com`
          ) {
            return Response.json({ keys: [publicJwk] });
          }
          return new Response(null, {
            status: ERR.UPSTREAM_UNREACHABLE.status,
          });
        },
      },
    });
    await admin.ready;
    adminUrl = (await admin.url).origin;
    const now = Math.floor(Date.now() / 1000);
    token = await new SignJWT({ email: EMAIL })
      .setProtectedHeader({ alg: "RS256", kid: "test" })
      .setIssuer(`https://${TEAM}.cloudflareaccess.com`)
      .setAudience(AUD)
      .setIssuedAt(now - 60)
      .setExpirationTime(now + 600)
      .sign(access.privateKey);
    const auth = ["--admin-url", adminUrl, "--token", token];

    const diff = await edgway(["diff", ...auth], project);
    expect(diff.stderr).toBe("");
    expect(diff.code).toBe(0);
    expect(diff.stdout).toContain("+ services.");
    expect(diff.stdout).toContain("httpbin-anything");
    // The second import created no duplicates: 2 services, 2 routes, 1 consumer.
    expect(diff.stdout.match(/^\+ services\./gm)).toHaveLength(2);
    expect(diff.stdout.match(/^\+ routes\./gm)).toHaveLength(2);

    // --exit-code: 1 while there is something to publish; --json: the changes.
    expect((await edgway(["diff", "--exit-code", ...auth], project)).code).toBe(
      1,
    );
    const asJson = await edgway(["diff", "--json", ...auth], project);
    expect(asJson.code).toBe(0);
    expect(
      (JSON.parse(asJson.stdout) as { changes: unknown[] }).changes.length,
    ).toBeGreaterThan(0);

    const published = await edgway(
      ["publish", "--note", "cli test", "--json", ...auth],
      project,
    );
    expect(published.code).toBe(0);
    expect(JSON.parse(published.stdout)).toMatchObject({ version: 1 });
    const after = await edgway(["diff", "--exit-code", ...auth], project);
    expect(after.code).toBe(0);
    expect(after.stdout).toContain("No pending changes");
  });

  it("import-deck --remote, versions and rollback against the admin", async () => {
    const auth = ["--admin-url", adminUrl, "--token", token];
    const file = path.join(project, "remote.yaml");
    writeFileSync(
      file,
      // An upstream on least-connections: published, with a warning.
      '_format_version: "3.0"\nservices:\n  - name: remote-svc\n    url: https://remote.example.com\nupstreams:\n  - name: remote-pool\n    algorithm: least-connections\n',
    );
    const noToken = await edgway(
      ["import-deck", file, "--remote", "--admin-url", adminUrl],
      project,
    );
    expect(noToken.code).toBe(1);
    expect(noToken.stderr).toContain("--kong-token");
    // Cloudflare Access in front of the mount answers with a redirect to its
    // login page: reported clearly, not followed.
    const access = createServer((_req, res) => {
      res.writeHead(302, {
        location: "https://login.example.com",
        "content-type": "text/html",
      });
      res.end("<html>sign in</html>");
    });
    await new Promise<void>((resolve) =>
      access.listen(0, "127.0.0.1", resolve),
    );
    const { port } = access.address() as AddressInfo;
    const notKong = await edgway(
      [
        "import-deck",
        file,
        "--remote",
        "--admin-url",
        `http://127.0.0.1:${port}`,
        "--kong-token",
        KONG_TOKEN,
      ],
      project,
    );
    access.close();
    expect(notKong.code).toBe(1);
    expect(notKong.stderr).toContain("302 without JSON");
    const imported = await edgway(
      [
        "import-deck",
        file,
        "--remote",
        "--admin-url",
        adminUrl,
        "--kong-token",
        KONG_TOKEN,
      ],
      project,
    );
    expect(imported.code).toBe(0);
    const diff = await edgway(["diff", ...auth], project);
    expect(diff.stdout).toContain("remote-svc");
    const publishedRemote = await edgway(["publish", ...auth], project);
    expect(publishedRemote.code).toBe(0);
    expect(publishedRemote.stderr).toContain(
      "upstream remote-pool uses least-connections, which runs as round-robin on Workers",
    );

    const listed = await edgway(["versions", ...auth], project);
    expect(listed.code).toBe(0);
    expect(listed.stdout).toContain("Version 2 (live)");
    expect(listed.stdout).toContain("cli test");
    const rolled = await edgway(["rollback", "1", ...auth], project);
    expect(rolled.code).toBe(0);
    expect(rolled.stdout).toContain("Version 1 is live");
    expect((await edgway(["versions", ...auth], project)).stdout).toContain(
      "Version 1 (live)",
    );
    const json = await edgway(["versions", "--json", ...auth], project);
    expect(JSON.parse(json.stdout)).toMatchObject({ current: 1 });
  });

  it("diff and publish fail clearly without an admin or identity", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "edgway-noadmin-"));
    const none = await edgway(["diff"], dir);
    expect(none.code).not.toBe(0);
    expect(none.stderr).toContain("--admin-url");
    const anonymous = await edgway(["publish", "--admin-url", adminUrl], dir);
    expect(anonymous.code).not.toBe(0);
    expect(anonymous.stderr).toContain("401");
  });

  it("deploy --dry-run bundles the three Workers, touching nothing remote", async () => {
    const { code, stdout } = await edgway(["deploy", "--dry-run"], project);
    expect(code).toBe(0);
    // The three wrangler dry runs, then one finish line.
    expect(stdout.match(/Running wrangler deploy --dry-run/g)).toHaveLength(3);
    expect(stdout).toContain(CLI.portalConfig);
    expect(stdout.match(/three Workers/g)).toHaveLength(1);
  });
});
