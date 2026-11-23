/**
 * The portal Worker's key API: OIDC-verified developers manage only
 * their own consumer's keys, and each change goes live through a
 * credential-only publish the gateway accepts. Keys have names and roll one
 * at a time; developers are labelled from the IdP's userinfo.
 */
import {
  createExecutionContext,
  env,
  waitOnExecutionContext,
} from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { type Snapshot, verifySnapshot } from "@edgway/adapters-cf";
import { createAdminCore, currentVersion } from "@edgway/admin-core";
import {
  ADMIN,
  ANALYTICS,
  AUTHORIZATION,
  HEADER,
  KV_KEY,
  MEDIA_TYPE,
  PORTAL,
} from "@edgway/constants";
import { ERR, STATUS } from "@edgway/errors";
import { importJWK, type JWK, SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { PORTAL_API, type PortalKey } from "../src/routes";
import worker, { type Env } from "../src/worker";

const idpKey = await importJWK(JSON.parse(env.TEST_IDP_KEY) as JWK, "RS256");
const publicKey = await importJWK(
  JSON.parse(env.TEST_PUBLIC_KEY) as JWK,
  "EdDSA",
);

/** An access token from the test IdP. */
const token = (
  sub: string,
  options: { issuer?: string; audience?: string } = {},
) =>
  new SignJWT({})
    .setProtectedHeader({ alg: "RS256", kid: "idp" })
    .setIssuer(options.issuer ?? env.OIDC_ISSUER)
    .setAudience(options.audience ?? env.OIDC_AUDIENCE ?? "")
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(idpKey);

async function call(
  who: string | undefined,
  method: string,
  path: string,
  options: { auth?: string; body?: unknown } = {},
) {
  const headers: Record<string, string> = {};
  const bearer = options.auth ?? (who ? await token(who) : undefined);
  if (bearer) headers[HEADER.authorization] = AUTHORIZATION.bearer(bearer);
  if (options.body !== undefined) {
    headers[HEADER.contentType] = MEDIA_TYPE.json;
  }
  return exports.default.fetch(
    new Request(`https://portal.test${path}`, {
      method,
      headers,
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
    }),
  );
}

/** A developer's keys, as the portal lists them. */
const keysOf = async (who: string) =>
  (await call(who, "GET", PORTAL_API.keys)).json<PortalKey[]>();

const admin = () =>
  createAdminCore(env.DB, {
    workspaceId: ADMIN.defaultWorkspaceId,
    actor: "admin@example.com",
  });

/** The live snapshot, verified as a gateway verifies it (none yet: undefined). */
async function liveNow(): Promise<Snapshot | undefined> {
  const version = await currentVersion(env.CONFIG_KV);
  if (version === undefined) return undefined;
  const stored = await env.CONFIG_KV.get<{
    manifest: string;
    snapshot: string;
  }>(KV_KEY.configVersion(version), "json");
  if (!stored) return undefined;
  const verified = await verifySnapshot<Snapshot>(
    stored,
    version,
    publicKey as CryptoKey,
  );
  if (typeof verified === "string") throw new Error(verified);
  return verified.config;
}

/**
 * The live snapshot once `ready` holds: keys go live in the admin's next
 * batch, about PORTAL.publishBatchMs after the change.
 */
async function live(
  ready: (snapshot: Snapshot) => boolean = () => true,
): Promise<Snapshot> {
  const deadline = Date.now() + PORTAL.publishBatchMs * 8;
  for (;;) {
    const snapshot = await liveNow();
    if (snapshot && ready(snapshot)) return snapshot;
    if (Date.now() > deadline) {
      if (!snapshot) throw new Error("nothing published");
      return snapshot;
    }
    await scheduler.wait(100);
  }
}

const keyIds = (snapshot: Snapshot) =>
  (snapshot.keyauth_credentials ?? []).map((k) => k.id);

describe("authentication", () => {
  it("refuses missing, malformed, foreign and wrong-audience tokens", async () => {
    const foreign = await token("x", { issuer: "https://evil.test" });
    const wrongAud = await token("x", { audience: "someone-else" });
    for (const auth of [undefined, "not-a-jwt", foreign, wrongAud]) {
      const res = await call(undefined, "GET", PORTAL_API.keys, { auth });
      expect(res.status).toBe(ERR.ADMIN_UNAUTHENTICATED.status);
    }
  });

  it("is off without an issuer", async () => {
    const res = await worker.fetch(
      new Request(`https://portal.test${PORTAL_API.keys}`, {
        headers: {
          [HEADER.authorization]: AUTHORIZATION.bearer(await token("x")),
        },
      }),
      { ...env, OIDC_ISSUER: "" },
      createExecutionContext(),
    );
    expect(res.status).toBe(ERR.PORTAL_SIGN_IN_DISABLED.status);
    // its own code, naming what's missing.
    expect(await res.json()).toMatchObject({
      code: ERR.PORTAL_SIGN_IN_DISABLED.code,
      detail: "OIDC_ISSUER",
    });
  });

  it("is off without an audience", async () => {
    const res = await worker.fetch(
      new Request(`https://portal.test${PORTAL_API.keys}`, {
        headers: {
          [HEADER.authorization]: AUTHORIZATION.bearer(await token("x")),
        },
      }),
      { ...env, OIDC_AUDIENCE: "" },
      createExecutionContext(),
    );
    expect(await res.json()).toMatchObject({
      code: ERR.PORTAL_SIGN_IN_DISABLED.code,
      detail: "OIDC_AUDIENCE",
    });
  });
});

describe("developer identity", () => {
  it("never lets a developer claim a consumer an admin made", async () => {
    // An admin's consumer whose custom_id happens to equal the developer's sub.
    const theirs = await admin().consumers.create({ custom_id: "dev-claim" });
    await admin().keyAuth.create({ consumer_id: String(theirs.id) });
    expect(await keysOf("dev-claim")).toEqual([]);
    const { consumer: mine } = await admin().portal.signIn("dev-claim");
    expect(mine.id).not.toBe(theirs.id);
    // The portal's subject is never shown through the entity API.
    expect(await admin().consumers.get(String(mine.id))).not.toHaveProperty(
      "portal_subject",
    );
  });

  it("labels a developer by verified email, else name, from the IdP", async () => {
    await keysOf("dev-label");
    const shown = async (sub: string) => {
      const { consumer } = await admin().portal.signIn(sub);
      // The label is for admins only: never the Kong username.
      expect(consumer.username ?? null).toBeNull();
      return consumer.display_name ?? null;
    };
    expect(await shown("dev-label")).toBe("dev-label@example.test");
    // An email an admin's consumer holds as its username is still only a label.
    await admin().consumers.create({ username: "taken@example.test" });
    await keysOf("dev-clash");
    expect(await shown("dev-clash")).toBe("taken@example.test");
    // An email the IdP hasn't verified is never used: the name instead.
    await keysOf("dev-unverified");
    expect(await shown("dev-unverified")).toBe("Name dev-unverified");
    // An IdP with no profile: no label, and the developer still works.
    const res = await call("dev-noprofile", "GET", PORTAL_API.keys);
    expect(res.status).toBe(STATUS.ok);
    expect(await shown("dev-noprofile")).toBeNull();
  });

  it("never lets a developer claim a username decK will use", async () => {
    // The IdP calls this developer "acme-partner" (an unverified email, so
    // the name is used) before any operator does.
    await keysOf("dev-unverified-squat");
    const { consumer: dev } = await admin().portal.signIn(
      "dev-unverified-squat",
    );
    expect(dev.display_name).toBe("acme-partner");
    expect(dev.username ?? null).toBeNull();
    // decK (the Kong mount's PUT by username) then makes its own consumer.
    const { data } = await admin().consumers.list({
      where: { username: "acme-partner" },
    });
    expect(data).toEqual([]);
    const ops = await admin().consumers.create({ username: "acme-partner" });
    expect(ops.id).not.toBe(dev.id);
  });

  it("limits the keys one developer can hold", async () => {
    let first: PortalKey | undefined;
    for (let i = 0; i < PORTAL.maxKeysPerConsumer; i++) {
      const res = await call("dev-many", "POST", PORTAL_API.keys);
      expect(res.status).toBe(STATUS.created);
      first ??= await res.json<PortalKey>();
    }
    const over = await call("dev-many", "POST", PORTAL_API.keys);
    expect(over.status).toBe(ERR.ADMIN_KEY_LIMIT.status);
    expect(await over.json()).toMatchObject({ code: ERR.ADMIN_KEY_LIMIT.code });
    // Rolling replaces a key, so it is allowed at the limit.
    expect(
      (await call("dev-many", "POST", PORTAL_API.roll(first?.id ?? ""))).status,
    ).toBe(STATUS.created);
  });

  it("rate limits one developer's key writes, not another's", async () => {
    // Create and delete: each a write, never past the key limit.
    const statuses: number[] = [];
    for (let i = 0; i < PORTAL.writesPerMinute; i++) {
      const created = await call("dev-churn", "POST", PORTAL_API.keys);
      statuses.push(created.status);
      if (created.ok) {
        const { id } = await created.json<PortalKey>();
        statuses.push(
          (await call("dev-churn", "DELETE", PORTAL_API.key(id))).status,
        );
      }
    }
    // The first writesPerMinute writes pass; then 429.
    expect(statuses.slice(0, PORTAL.writesPerMinute)).not.toContain(
      ERR.RATE_LIMITED.status,
    );
    expect(statuses).toContain(ERR.RATE_LIMITED.status);
    const over = await call("dev-churn", "POST", PORTAL_API.keys);
    expect(over.status).toBe(ERR.RATE_LIMITED.status);
    expect(await over.json()).toMatchObject({ code: ERR.RATE_LIMITED.code });
    // Reads aren't limited, and another developer isn't either.
    expect((await call("dev-churn", "GET", PORTAL_API.keys)).status).toBe(
      STATUS.ok,
    );
    expect((await call("dev-calm", "POST", PORTAL_API.keys)).status).toBe(
      STATUS.created,
    );
  });

  it("holds the limit when a developer creates keys concurrently", async () => {
    // Signed in once first, so the consumer exists.
    await keysOf("dev-race");
    const results = await Promise.all(
      Array.from({ length: PORTAL.maxKeysPerConsumer + 3 }, () =>
        call("dev-race", "POST", PORTAL_API.keys),
      ),
    );
    const codes = await Promise.all(
      results.map(async (res) => (await res.json<{ code?: string }>()).code),
    );
    // Exactly the requests past the limit are refused.
    expect(codes.filter((c) => c === ERR.ADMIN_KEY_LIMIT.code)).toHaveLength(3);
    expect(await keysOf("dev-race")).toHaveLength(PORTAL.maxKeysPerConsumer);
  });
});

describe("blocked developers", () => {
  it("refuses a developer an admin blocked, and lets them back once unblocked", async () => {
    await keysOf("dev-blocked");
    const { consumer } = await admin().portal.signIn("dev-blocked");
    await admin().portal.block(String(consumer.id));
    for (const [method, path] of [
      ["GET", PORTAL_API.keys],
      ["POST", PORTAL_API.keys],
    ] as const) {
      const res = await call("dev-blocked", method, path);
      expect(res.status).toBe(ERR.ADMIN_FORBIDDEN.status);
      expect(await res.json()).toMatchObject({
        code: ERR.ADMIN_FORBIDDEN.code,
      });
    }
    // Still one consumer for the subject: signing in again made no other.
    expect(
      (await admin().consumers.list()).data.filter((c) => c.id === consumer.id),
    ).toHaveLength(1);
    await admin().portal.unblock(String(consumer.id));
    expect((await call("dev-blocked", "GET", PORTAL_API.keys)).status).toBe(
      STATUS.ok,
    );
  });
});

describe("sign-up allow-list", () => {
  /** The key list for `who`, with PORTAL_ALLOWED_EMAIL_DOMAINS set to `domains`. */
  const listAs = async (who: string, domains: string | undefined) =>
    worker.fetch(
      new Request(`https://portal.test${PORTAL_API.keys}`, {
        headers: {
          [HEADER.authorization]: AUTHORIZATION.bearer(await token(who)),
        },
      }),
      { ...env, PORTAL_ALLOWED_EMAIL_DOMAINS: domains },
      createExecutionContext(),
    );
  const consumers = async () => (await admin().consumers.list()).data.length;

  it("admits a developer whose verified email is at a listed domain", async () => {
    // The test IdP gives `<sub>@example.test`; case doesn't matter.
    const res = await listAs("dev-allowed", "other.test, Example.TEST");
    expect(res.status).toBe(STATUS.ok);
  });

  it("refuses any other domain, and makes no consumer", async () => {
    const before = await consumers();
    const res = await listAs("dev-outsider", "other.test");
    expect(res.status).toBe(ERR.ADMIN_FORBIDDEN.status);
    expect(await res.json()).toMatchObject({
      code: ERR.ADMIN_FORBIDDEN.code,
      detail: PORTAL.notAllowedDetail,
    });
    expect(await consumers()).toBe(before);
  });

  it("refuses an email the IdP hasn't verified, or no profile at all", async () => {
    const before = await consumers();
    // Unverified: its own detail, which the developer can act on.
    const unverified = await listAs("dev-unverified-allow", "example.test");
    expect(unverified.status).toBe(ERR.ADMIN_FORBIDDEN.status);
    expect(await unverified.json()).toMatchObject({
      detail: PORTAL.unverifiedDetail,
    });
    // No profile: no email to verify, so not allowed.
    const none = await listAs("dev-noprofile-allow", "example.test");
    expect(none.status).toBe(ERR.ADMIN_FORBIDDEN.status);
    expect(await none.json()).toMatchObject({
      detail: PORTAL.notAllowedDetail,
    });
    expect(await consumers()).toBe(before);
  });

  it("admits anyone the IdP signs in when no domain is listed", async () => {
    for (const domains of [undefined, "", " , "]) {
      const res = await listAs("dev-open", domains);
      expect(res.status).toBe(STATUS.ok);
    }
  });
});

describe("self-serve keys", () => {
  it("creates the developer's consumer on first sign-in", async () => {
    const res = await call("dev-first", "GET", PORTAL_API.keys);
    expect(res.status).toBe(STATUS.ok);
    expect(await res.json()).toEqual([]);
    const first = (await admin().portal.signIn("dev-first")).consumer.id;
    await keysOf("dev-first");
    // The same developer gets the same consumer next time.
    expect((await admin().portal.signIn("dev-first")).consumer.id).toBe(first);
  });

  it("issues a named key that goes live, and nothing else staged does", async () => {
    // An admin's unpublished change.
    const draft = await admin().services.create({
      name: "draft",
      host: "d.test",
    });

    const created = await call("dev-a", "POST", PORTAL_API.keys, {
      body: { name: "  laptop  " },
    });
    expect(created.status).toBe(STATUS.created);
    const key = await created.json<PortalKey>();
    expect(key.name).toBe("laptop");
    expect(key.key?.length).toBeGreaterThan(10);
    expect(key.key?.startsWith(key.prefix)).toBe(true);

    const snapshot = await live((s) => keyIds(s).includes(key.id));
    expect(snapshot.services.map((s) => s.id)).not.toContain(draft.id);
    expect(snapshot.keyauth_credentials?.map((k) => k.id)).toContain(key.id);
    // Listed afterwards: its name and prefix, never a key value.
    const mine = await keysOf("dev-a");
    expect(mine).toEqual([
      {
        id: key.id,
        name: "laptop",
        prefix: key.prefix,
        createdOn: key.createdOn,
      },
    ]);
    expect(mine[0]).not.toHaveProperty("key");
  });

  it("refuses an over-long name and renames a key", async () => {
    const tooLong = "x".repeat(PORTAL.maxKeyNameLength + 1);
    const refused = await call("dev-name", "POST", PORTAL_API.keys, {
      body: { name: tooLong },
    });
    expect(refused.status).toBe(ERR.ADMIN_INVALID_REQUEST.status);
    const key = await (
      await call("dev-name", "POST", PORTAL_API.keys)
    ).json<PortalKey>();
    expect(key.name).toBeNull();
    const renamed = await call("dev-name", "PATCH", PORTAL_API.key(key.id), {
      body: { name: "ci server" },
    });
    expect(renamed.status).toBe(STATUS.ok);
    expect(await renamed.json()).toMatchObject({
      id: key.id,
      name: "ci server",
    });
    expect(
      (
        await call("dev-name", "PATCH", PORTAL_API.key(key.id), {
          body: { name: " " },
        })
      ).status,
    ).toBe(ERR.ADMIN_INVALID_REQUEST.status);
  });

  it("never lets a developer touch another developer's key", async () => {
    const theirs = await (
      await call("dev-b", "POST", PORTAL_API.keys)
    ).json<PortalKey>();
    for (const [method, path, body] of [
      ["DELETE", PORTAL_API.key(theirs.id), undefined],
      ["PATCH", PORTAL_API.key(theirs.id), { name: "mine now" }],
      ["POST", PORTAL_API.roll(theirs.id), undefined],
    ] as const) {
      const res = await call("dev-c", method, path, { body });
      expect(res.status).toBe(ERR.ADMIN_NOT_FOUND.status);
    }
    expect(await keysOf("dev-b")).toMatchObject([
      { id: theirs.id, name: null, prefix: theirs.prefix },
    ]);
    expect(keyIds(await live((s) => keyIds(s).includes(theirs.id)))).toContain(
      theirs.id,
    );
  });

  it("rolls one key, keeping its name, and leaves the others live", async () => {
    const first = await (
      await call("dev-d", "POST", PORTAL_API.keys, { body: { name: "one" } })
    ).json<PortalKey>();
    const second = await (
      await call("dev-d", "POST", PORTAL_API.keys, { body: { name: "two" } })
    ).json<PortalKey>();
    const hashOf = async (id: string) =>
      (await live()).keyauth_credentials?.find((k) => k.id === id)?.key_hash;
    await live((s) => keyIds(s).includes(second.id));
    const before = await hashOf(first.id);

    const res = await call("dev-d", "POST", PORTAL_API.roll(first.id));
    expect(res.status).toBe(STATUS.created);
    const rolled = await res.json<PortalKey>();
    expect(rolled).toMatchObject({ id: first.id, name: "one" });
    expect(rolled.key).not.toBe(first.key);
    // Live: the same key entry with a new hash; the other key is untouched.
    const snapshot = await live(
      (s) =>
        s.keyauth_credentials?.find((k) => k.id === first.id)?.key_hash !==
        before,
    );
    expect(keyIds(snapshot)).toEqual(
      expect.arrayContaining([first.id, second.id]),
    );
    expect(await hashOf(first.id)).not.toBe(before);
    expect((await keysOf("dev-d")).map((k) => k.name).sort()).toEqual([
      "one",
      "two",
    ]);

    const deleted = await call("dev-d", "DELETE", PORTAL_API.key(first.id));
    expect(deleted.status).toBe(STATUS.noContent);
    const ids = keyIds(await live((s) => !keyIds(s).includes(first.id)));
    expect(ids).not.toContain(first.id);
    expect(ids).toContain(second.id);
  });
});

describe("batched go-live", () => {
  it("publishes a burst of key changes in fewer versions than changes", async () => {
    await keysOf("dev-burst");
    const before = (await currentVersion(env.CONFIG_KV)) ?? 0;
    const made: PortalKey[] = [];
    for (let i = 0; i < PORTAL.maxKeysPerConsumer; i++) {
      const res = await call("dev-burst", "POST", PORTAL_API.keys);
      expect(res.status).toBe(STATUS.created);
      made.push(await res.json<PortalKey>());
    }
    const snapshot = await live((s) =>
      made.every((k) => keyIds(s).includes(k.id)),
    );
    expect(made.every((k) => keyIds(snapshot).includes(k.id))).toBe(true);
    const after = (await currentVersion(env.CONFIG_KV)) ?? 0;
    expect(after - before).toBeLessThan(made.length);
  });

  it("leaves one row after concurrent rolls of one key", async () => {
    const key = await (
      await call("dev-rolls", "POST", PORTAL_API.keys)
    ).json<PortalKey>();
    const rolled = await Promise.all(
      Array.from({ length: 4 }, () =>
        call("dev-rolls", "POST", PORTAL_API.roll(key.id)),
      ),
    );
    expect(rolled.every((r) => r.status === STATUS.created)).toBe(true);
    expect((await keysOf("dev-rolls")).map((k) => k.id)).toEqual([key.id]);
  });
});

describe("usage", () => {
  const analytics = { CF_ACCOUNT_ID: "acc", AE_API_TOKEN: "tok" };
  const usageOf = async (who: string, extra: Partial<Env> = analytics) =>
    worker.fetch(
      new Request(`https://portal.test${PORTAL_API.usage}`, {
        headers: {
          [HEADER.authorization]: AUTHORIZATION.bearer(await token(who)),
        },
      }),
      { ...env, ...extra },
      createExecutionContext(),
    );
  const consumerOf = async (sub: string) =>
    (
      await env.DB.prepare("SELECT id FROM consumers WHERE portal_subject = ?")
        .bind(sub)
        .first<{ id: string }>()
    )?.id;

  it("is empty, not an error, without Analytics Engine access", async () => {
    const res = await usageOf("usage-off", {});
    expect(res.status).toBe(STATUS.ok);
    expect(await res.json()).toEqual({
      configured: false,
      days: ANALYTICS.portalUsageDays,
      daily: [],
    });
  });

  const lastSql = async () =>
    (await fetch("https://api.cloudflare.com/__last-sql")).json<{
      sql: string;
      queries: number;
    }>();

  it("reads only the signed-in developer's own consumer", async () => {
    const res = await usageOf("usage-a");
    expect(res.status).toBe(STATUS.ok);
    expect(await res.json()).toEqual({
      configured: true,
      days: ANALYTICS.portalUsageDays,
      daily: [{ day: "2026-10-06 00:00:00", requests: 3, errors: 1 }],
    });
    const mine = await consumerOf("usage-a");
    const { sql } = await lastSql();
    expect(mine).toBeTruthy();
    expect(sql).toContain(`= '${mine}'`);

    await usageOf("usage-b");
    const other = await consumerOf("usage-b");
    const second = (await lastSql()).sql;
    expect(second).toContain(`= '${other}'`);
    expect(second).not.toContain(String(mine));
  });

  it("keeps a developer's answer for a minute rather than asking again", async () => {
    await usageOf("usage-cache");
    const before = (await lastSql()).queries;
    await usageOf("usage-cache");
    expect((await lastSql()).queries).toBe(before);
  });

  it("needs a signed-in developer", async () => {
    const res = await worker.fetch(
      new Request(`https://portal.test${PORTAL_API.usage}`),
      { ...env, ...analytics },
      createExecutionContext(),
    );
    expect(res.status).toBe(ERR.ADMIN_UNAUTHENTICATED.status);
  });
});

describe("security headers", () => {
  const connectSrc = (res: Response) =>
    (res.headers.get("content-security-policy") ?? "")
      .split(";")
      .find((d) => d.trim().startsWith("connect-src"))
      ?.trim()
      .split(/\s+/) ?? [];
  const check = (res: Response) => {
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("frame-ancestors 'none'");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("referrer-policy")).toBe(
      "strict-origin-when-cross-origin",
    );
  };
  /** A request to the Worker, and its background work. */
  async function fetchWith(path: string, bindings: Partial<Env> = {}) {
    const ctx = createExecutionContext();
    const res = await worker.fetch(
      new Request(`https://portal.test${path}`),
      { ...env, ...bindings } as Env,
      ctx,
    );
    return { res, ctx };
  }

  it("are on the API's answers and the static site", async () => {
    // Discovery runs in the background: let it finish once.
    const first = await fetchWith("/");
    await waitOnExecutionContext(first.ctx);
    check(first.res);
    // An error answer (no token), a success, and the static site (no
    // ASSETS in tests: a 404, still with the headers).
    for (const res of [
      await call(undefined, "GET", PORTAL_API.keys),
      await call("dev-headers", "GET", PORTAL_API.keys),
      (await fetchWith("/")).res,
    ]) {
      check(res);
      // The issuer, its other endpoints' hosts and PORTAL_CONNECT_SRC.
      const connect = connectSrc(res);
      expect(connect).toEqual(
        expect.arrayContaining([
          "'self'",
          new URL(env.OIDC_ISSUER).origin,
          "https://tokens.idp.test",
          "https://api.example.test",
        ]),
      );
      expect(connect).not.toContain("not-a-url");
    }
  });

  it("never wait for an IdP that doesn't answer", async () => {
    // Discovery of this issuer never settles; the response mustn't wait.
    const answered = fetchWith("/", { OIDC_ISSUER: "https://hang.idp.test" });
    const winner = await Promise.race([
      answered.then(({ res }) => res),
      scheduler.wait(5_000).then(() => "waited" as const),
    ]);
    expect(winner).not.toBe("waited");
    const res = winner as Response;
    check(res);
    expect(connectSrc(res)).toContain("https://hang.idp.test");
  });

  it("back off from an IdP that fails, rather than asking on every request", async () => {
    const down = { OIDC_ISSUER: "https://down.idp.test" };
    const discoveries = async () =>
      (
        await (
          await fetch("https://down.idp.test/__count")
        ).json<{
          discoveries: number;
        }>()
      ).discoveries;
    const before = await discoveries();
    // A page and its assets: each one's background work runs to the end.
    for (const path of [
      "/",
      "/assets/app.js",
      "/assets/app.css",
      "/logo.svg",
    ]) {
      const { res, ctx } = await fetchWith(path, down);
      await waitOnExecutionContext(ctx);
      check(res);
      expect(connectSrc(res)).toContain("https://down.idp.test");
    }
    // One failed discovery, then the back-off (PORTAL.discoveryRetryMs).
    expect((await discoveries()) - before).toBe(1);
  });
});
