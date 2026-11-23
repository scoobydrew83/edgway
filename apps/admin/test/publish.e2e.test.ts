/**
 * End to end: entities created through the admin API are published,
 * signed, and served by the real gateway Worker; a rollback makes the gateway
 * serve the earlier version again.
 */
import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { createAdminCore } from "@edgway/admin-core";
import { ADMIN, CONFIG, HEADER, KV_KEY, MEDIA_TYPE } from "@edgway/constants";
import { ERR, STATUS } from "@edgway/errors";
import { importJWK, type JWK, SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { API_BASE } from "../src/roles";

const key = await importJWK(JSON.parse(env.TEST_ACCESS_KEY) as JWK, "RS256");

async function admin(
  who: string,
  method: string,
  path: string,
  body?: unknown,
) {
  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({ email: who })
    .setProtectedHeader({ alg: "RS256", kid: "test" })
    .setIssuer(`https://${env.ACCESS_TEAM}.cloudflareaccess.com`)
    .setAudience(env.ACCESS_AUD)
    .setIssuedAt(now - 60)
    .setExpirationTime(now + 300)
    .sign(key);
  const headers: Record<string, string> = {
    [HEADER.cfAccessJwtAssertion]: token,
  };
  if (body !== undefined) headers[HEADER.contentType] = MEDIA_TYPE.json;
  const res = await exports.default.fetch(
    new Request(`https://admin.test${API_BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  return res;
}

const EDITOR = "editor@example.com";
const PUBLISHER = "publisher@example.com";

const gateway = (path: string) =>
  env.GATEWAY.fetch(
    new Request(`https://gw.test${path}`, {
      headers: { [HEADER.clientIp]: "203.0.113.9" },
    }),
  );

/** Poll the gateway until `check` holds (it re-reads the pointer every second). */
async function eventually(check: () => Promise<boolean>) {
  for (let i = 0; i < 40; i++) {
    if (await check()) return true;
    await scheduler.wait(100);
  }
  return false;
}

describe("publish → gateway → rollback", () => {
  it("serves published config and rolls back", async () => {
    // Staged entities, including a key-auth credential.
    const service = await (
      await admin(EDITOR, "POST", "/services", {
        name: "e2e",
        protocol: "https",
        host: "api.upstream.test",
        port: 443,
        path: "/v1",
      })
    ).json<{ id: string }>();
    const route = await (
      await admin(EDITOR, "POST", "/routes", {
        name: "e2e",
        service_id: service.id,
        paths: ["/e2e"],
      })
    ).json<{ id: string }>();
    await admin(EDITOR, "POST", "/plugins", {
      name: "key-auth",
      route_id: route.id,
      config: { key_names: ["apikey"], hide_credentials: true },
    });
    await admin(EDITOR, "POST", "/consumers", { username: "e2e-user" });
    const { key: apiKey } = await (
      await admin(EDITOR, "POST", "/consumers/e2e-user/key-auth", {})
    ).json<{ key: string }>();

    // Only publishers publish.
    const denied = await admin(EDITOR, "POST", "/config/publish", {});
    expect(denied.status).toBe(ERR.ADMIN_ROLE_REQUIRED.status);

    const pending = await (await admin(EDITOR, "GET", "/config/pending")).json<{
      changes: unknown[];
    }>();
    expect(pending.changes.length).toBeGreaterThan(0);
    expect(JSON.stringify(pending)).not.toContain(apiKey);

    const v1 = await admin(PUBLISHER, "POST", "/config/publish", {
      note: "v1",
    });
    expect(v1.status).toBe(STATUS.created);
    const first = await v1.json<{ version: number }>();

    // The gateway serves v1: key-auth enforced, upstream reached with the key hidden.
    expect(
      await eventually(async () => {
        const res = await gateway(`/e2e/items?apikey=${apiKey}`);
        return res.status === STATUS.ok;
      }),
    ).toBe(true);
    const ok = await gateway(`/e2e/items?apikey=${apiKey}`);
    expect(await ok.json()).toEqual({
      upstream: true,
      url: "https://api.upstream.test/v1/items",
    });
    expect((await gateway("/e2e/items")).status).toBe(ERR.AUTH_REQUIRED.status);

    // v2 terminates the route instead.
    await admin(EDITOR, "POST", "/plugins", {
      name: "request-termination",
      route_id: route.id,
      config: { status_code: 418, message: "v2" },
    });
    const v2 = await (
      await admin(PUBLISHER, "POST", "/config/publish", { note: "v2" })
    ).json<{ version: number }>();
    expect(v2.version).toBe(first.version + 1);
    expect(
      await eventually(async () => {
        const res = await gateway(`/e2e/items?apikey=${apiKey}`);
        return res.status === 418;
      }),
    ).toBe(true);

    // Roll back: the gateway serves v1 again.
    const rolled = await admin(PUBLISHER, "POST", "/config/rollback", {
      version: first.version,
    });
    expect(await rolled.json()).toEqual({
      version: first.version,
      from: v2.version,
      revived: [],
    });
    expect(
      await eventually(async () => {
        const res = await gateway(`/e2e/items?apikey=${apiKey}`);
        return res.status === STATUS.ok;
      }),
    ).toBe(true);

    const versions = await (
      await admin(EDITOR, "GET", "/config/versions")
    ).json<{
      current: number;
      data: { version: number; note: string }[];
    }>();
    expect(versions.current).toBe(first.version);
    expect(versions.data.map((v) => v.note)).toEqual(["v2", "v1"]);
  });
});

describe("revocations", () => {
  it("go live at once, and a rollback past one lists what it revives", async () => {
    const service = await (
      await admin(EDITOR, "POST", "/services", {
        name: "revoke",
        host: "api.upstream.test",
      })
    ).json<{ id: string }>();
    const route = await (
      await admin(EDITOR, "POST", "/routes", {
        name: "revoke",
        service_id: service.id,
        paths: ["/revoke"],
      })
    ).json<{ id: string }>();
    await admin(EDITOR, "POST", "/plugins", {
      name: "key-auth",
      route_id: route.id,
      config: { key_names: ["apikey"] },
    });
    await admin(EDITOR, "POST", "/consumers", { username: "revoke-user" });
    type Issued = { credential: { id: string }; key: string };
    const issue = async () =>
      (
        await admin(EDITOR, "POST", "/consumers/revoke-user/key-auth", {})
      ).json<Issued>();
    const deleted = await issue();
    const rotated = await issue();
    const before = await (
      await admin(PUBLISHER, "POST", "/config/publish", { note: "keys" })
    ).json<{ version: number }>();
    const works = (key: string) => async () =>
      (await gateway(`/revoke/x?apikey=${key}`)).status === STATUS.ok;
    expect(await eventually(works(deleted.key))).toBe(true);
    expect(await eventually(works(rotated.key))).toBe(true);

    // Something else staged meanwhile: it must not go live with them.
    await admin(EDITOR, "POST", "/services", {
      name: "revoke-staged",
      host: "staged.test",
    });
    const gone = await admin(
      EDITOR,
      "DELETE",
      `/key-auth/${deleted.credential.id}`,
    );
    expect(gone.status).toBe(STATUS.noContent);
    const fresh = await (
      await admin(EDITOR, "POST", `/key-auth/${rotated.credential.id}/rotate`)
    ).json<Issued>();
    // No full publish: the old keys stop working, the new one works.
    const refused = (key: string) => async () =>
      (await gateway(`/revoke/x?apikey=${key}`)).status !== STATUS.ok;
    expect(await eventually(refused(deleted.key))).toBe(true);
    expect(await eventually(refused(rotated.key))).toBe(true);
    expect(await eventually(works(fresh.key))).toBe(true);
    const pending = await (await admin(EDITOR, "GET", "/config/pending")).json<{
      changes: unknown[];
    }>();
    expect(JSON.stringify(pending.changes)).toContain("revoke-staged");

    // Rolling back past the revocations says which credentials come back.
    const rolled = await (
      await admin(PUBLISHER, "POST", "/config/rollback", {
        version: before.version,
      })
    ).json<{ revived: { entity: string; id: string }[] }>();
    expect(rolled.revived.map((r) => r.id).sort()).toEqual(
      [deleted.credential.id, rotated.credential.id].sort(),
    );
    expect(
      rolled.revived.every((r) => r.entity === "keyauth_credentials"),
    ).toBe(true);

    // Blocking a portal developer revokes their keys at once too.
    const { consumer: developer } = await createAdminCore(env.DB, {
      workspaceId: ADMIN.defaultWorkspaceId,
      actor: "test",
    }).portal.signIn("revoke-developer");
    const devKey = await (
      await admin(EDITOR, "POST", `/consumers/${developer.id}/key-auth`, {})
    ).json<Issued>();
    await admin(PUBLISHER, "POST", "/config/publish", { note: "developer" });
    expect(await eventually(works(devKey.key))).toBe(true);
    const blocked = await admin(
      EDITOR,
      "POST",
      `/consumers/${developer.id}/portal-block`,
    );
    expect(blocked.status).toBe(STATUS.ok);
    expect(await eventually(refused(devKey.key))).toBe(true);
  }, 30_000);
});

describe("the live version", () => {
  it("is reported from the ConfigVersion DO, never KV's unsigned pointer", async () => {
    await admin(EDITOR, "POST", "/services", {
      name: "live-version",
      host: "live.test",
    });
    const published = await (
      await admin(PUBLISHER, "POST", "/config/publish", { note: "live" })
    ).json<{ version: number }>();
    const versions = env.CONFIG_VERSION;
    if (!versions) throw new Error("the test admin binds CONFIG_VERSION");
    const live = await versions
      .get(versions.idFromName(CONFIG.versionObjectName))
      .current();
    expect(live).toBe(published.version);
    // A KV write alone (the pointer isn't signed) names another version.
    await env.CONFIG_KV.put(
      KV_KEY.configCurrent,
      JSON.stringify({ version: published.version + 100 }),
    );
    const pending = await (await admin(EDITOR, "GET", "/config/pending")).json<{
      version: number;
      changes: unknown[];
    }>();
    expect(pending.version).toBe(published.version);
    // Diffed against the live snapshot: nothing pending.
    expect(pending.changes).toEqual([]);
    const listed = await (await admin(EDITOR, "GET", "/config/versions")).json<{
      current: number;
    }>();
    expect(listed.current).toBe(published.version);
    const snapshots = await (
      await admin(EDITOR, "GET", "/config/snapshots")
    ).json<{ version: number }>();
    expect(snapshots.version).toBe(published.version);
  });
});
