/**
 * The edgway-portal Worker: Zudoku's static site, plus `/api`
 * for self-serve keys. A developer signs in with OIDC; their access token is
 * verified against the IdP's JWKS (discovered with openid-client, checked
 * with jose) and its audience, its `sub` names a
 * consumer (the internal `portal_subject`, created on first use: never a
 * consumer an admin made), and they manage only that consumer's
 * key-auth keys through @edgway/admin-core over the admin's D1. Each change
 * goes live through a credential-only publish: nothing else staged is
 * published by a developer.
 */
import { analyticsSql, createBindingStore } from "@edgway/adapters-cf";
import { type AdminCore, createAdminCore, type Row } from "@edgway/admin-core";
import {
  ADMIN,
  ANALYTICS,
  AUTH_SCHEME,
  CLI,
  HEADER,
  OIDC,
  PORTAL,
  SECURITY_HEADERS,
} from "@edgway/constants";
import { ERR, errorHandler, fail, STATUS } from "@edgway/errors";
import { i18nMiddleware } from "@edgway/i18n";
import { consumerUsageSql, requestIdMiddleware } from "@edgway/telemetry";
import { Hono, type MiddlewareHandler } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { createRemoteJWKSet, type JWTVerifyGetKey, jwtVerify } from "jose";
import * as oidc from "openid-client";
import {
  PORTAL_API,
  type PortalKey,
  type PortalKeyInput,
  type PortalUsage,
} from "./routes";

export interface Env {
  /** The portal's static site (Zudoku's build). */
  ASSETS?: Fetcher;
  /** The admin's D1: consumers and credentials are staged there. */
  DB: D1Database;
  /**
   * The admin's `PortalPublish` entrypoint (Service Binding): it
   * queues a developer's consumer and puts their keys live in its next
   * batch. The portal holds no signing key.
   */
  ADMIN?: PortalPublisherBinding;
  /** The OIDC issuer developers sign in with. Empty: the API is off. */
  OIDC_ISSUER: string;
  /** The audience access tokens must carry (often the client id). Empty: the API is off. */
  OIDC_AUDIENCE?: string;
  WORKSPACE_ID?: string;
  /**
   * Developers' key writes per minute: Cloudflare's Rate Limiting
   * binding, keyed by consumer; its limit and period match
   * PORTAL.writesPerMinute and PORTAL.writesPeriodSeconds.
   */
  PORTAL_WRITES?: RateLimit;
  /**
   * More origins the portal's pages may connect to, space- or
   * comma-separated: the API the reference's playground calls (usually the
   * gateway's origin).
   */
  PORTAL_CONNECT_SRC?: string;
  /**
   * Who may sign up, space- or comma-separated email domains. When
   * set, a developer gets a consumer only if the IdP's userinfo says their
   * email is verified and its domain is listed. Empty: anyone the IdP signs
   * in, as before.
   */
  PORTAL_ALLOWED_EMAIL_DOMAINS?: string;
  /**
   * Optional: a developer's usage panel reads Analytics Engine with
   * these, as the admin's overview does. AE_API_TOKEN is a secret with
   * Account Analytics Read only.
   */
  CF_ACCOUNT_ID?: string;
  AE_API_TOKEN?: string;
}

type Vars = { core: AdminCore; consumerId: string };

/** Per-isolate cache: the IdP's discovered configuration and key set. */
const idps = new Map<
  string,
  Promise<{ config: oidc.Configuration; jwks: JWTVerifyGetKey }>
>();

/**
 * The IdP from its discovery document (openid-client): its key set for
 * access tokens and its userinfo endpoint for developers' labels.
 * Plain HTTP only for a local issuer (tests, `wrangler dev`).
 */
function idp(issuer: string, audience: string) {
  let found = idps.get(issuer);
  if (!found) {
    const local = (CLI.localHosts as readonly string[]).includes(
      new URL(issuer).hostname,
    );
    found = oidc
      .discovery(
        new URL(issuer),
        audience,
        undefined,
        undefined,
        local ? { execute: [oidc.allowInsecureRequests] } : undefined,
      )
      .then((config) => {
        const { jwks_uri } = config.serverMetadata();
        if (!jwks_uri) throw new Error(jwks_uri);
        return { config, jwks: createRemoteJWKSet(new URL(jwks_uri)) };
      });
    // A failed discovery is retried on the next request.
    found.catch(() => idps.delete(issuer));
    idps.set(issuer, found);
  }
  return found;
}

/** Subjects this isolate already asked the IdP to label. */
const labelled = new Set<string>();

/** Subjects this isolate already admitted, per allow-list. */
const admitted = new Set<string>();

/** PORTAL_ALLOWED_EMAIL_DOMAINS, lower-cased. */
const allowedDomains = (env: Env) =>
  new Set(
    (env.PORTAL_ALLOWED_EMAIL_DOMAINS ?? "")
      .split(PORTAL.listSeparator)
      .filter(Boolean)
      .map((domain) => domain.toLowerCase()),
  );

/** What the portal needs from the admin's `PortalPublish` entrypoint. */
export interface PortalPublisherBinding {
  requestPublish(consumerId: string): Promise<void>;
}

/** The admin binding, or a clear 503 while it isn't configured. */
function publisher(env: Env): PortalPublisherBinding {
  if (!env.ADMIN) fail(ERR.ADMIN_PUBLISH_DISABLED, { detail: "ADMIN" });
  return env.ADMIN;
}

const asKey = (row: Row): PortalKey => ({
  id: String(row.id),
  name: row.name == null ? null : String(row.name),
  prefix: String(row.key_prefix ?? ""),
  createdOn: row.created_at
    ? new Date(Number(row.created_at) * 1000).toISOString()
    : undefined,
});

/** A key's name from a request body: trimmed, at most the label's length. */
async function keyName(
  req: { json(): Promise<unknown> },
  required: boolean,
): Promise<string | null> {
  const body = (await req.json().catch(() => ({}))) as PortalKeyInput;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if ((required && !name) || name.length > PORTAL.maxKeyNameLength) {
    fail(ERR.ADMIN_INVALID_REQUEST, { extensions: { field: "name" } });
  }
  return name || null;
}

const api = new Hono<{ Bindings: Env; Variables: Vars }>();

// The developer: a verified OIDC access token, mapped to their consumer.
api.use(`${PORTAL_API.base}/*`, async (c, next) => {
  // Both are required: without an audience, a token the IdP issued to any
  // other application would be accepted.
  const missing = (["OIDC_ISSUER", "OIDC_AUDIENCE"] as const).filter(
    (name) => !c.env[name],
  );
  if (missing.length > 0) {
    fail(ERR.PORTAL_SIGN_IN_DISABLED, { detail: missing.join(", ") });
  }
  const header = c.req.header(HEADER.authorization) ?? "";
  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== AUTH_SCHEME.bearer.toLowerCase() || !token) {
    fail(ERR.ADMIN_UNAUTHENTICATED);
  }
  const { config, jwks } = await idp(
    c.env.OIDC_ISSUER,
    c.env.OIDC_AUDIENCE ?? "",
  ).catch(() => fail(ERR.ADMIN_UNAUTHENTICATED));
  let sub: string | undefined;
  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: c.env.OIDC_ISSUER,
      audience: c.env.OIDC_AUDIENCE,
    });
    sub = payload.sub;
  } catch {
    fail(ERR.ADMIN_UNAUTHENTICATED);
  }
  if (!sub) fail(ERR.ADMIN_UNAUTHENTICATED);
  // Only developers with a verified email at a listed domain sign up, when
  // the operator lists domains: an IdP anyone can register with
  // doesn't hand out keys. Checked before the consumer is found or made.
  let profile: oidc.UserInfoResponse | undefined;
  const domains = allowedDomains(c.env);
  const admission = `${c.env.PORTAL_ALLOWED_EMAIL_DOMAINS}\n${sub}`;
  if (domains.size > 0 && !admitted.has(admission)) {
    profile = await oidc
      .fetchUserInfo(config, token, sub)
      .catch(() => undefined);
    // An email the IdP hasn't verified gets its own answer: the
    // developer can fix that, and it says nothing about the domains.
    if (profile?.email && profile.email_verified !== true) {
      fail(ERR.ADMIN_FORBIDDEN, { detail: PORTAL.unverifiedDetail });
    }
    const email = profile?.email_verified === true ? profile.email : undefined;
    const domain = email?.split("@").pop()?.toLowerCase();
    if (!domain || !domains.has(domain)) {
      fail(ERR.ADMIN_FORBIDDEN, { detail: PORTAL.notAllowedDetail });
    }
    admitted.add(admission);
  }
  const core = createAdminCore(c.env.DB, {
    workspaceId: c.env.WORKSPACE_ID || ADMIN.defaultWorkspaceId,
    actor: `oidc:${sub}`,
    requestId: c.get("requestId" as never),
  });
  const { consumer, blocked } = await core.portal.signIn(sub);
  // An admin revoked this developer.
  if (blocked) fail(ERR.ADMIN_FORBIDDEN, { detail: PORTAL.blockedDetail });
  // Admins see developers by email or name, not the subject: asked
  // of the IdP once per isolate until the consumer has a display name. An
  // email counts only once the IdP has verified it. The IdP's answer
  // never blocks the request.
  if (!consumer.display_name && !labelled.has(sub)) {
    labelled.add(sub);
    try {
      const info = profile ?? (await oidc.fetchUserInfo(config, token, sub));
      await core.portal.label(String(consumer.id), [
        info.email_verified === true ? info.email : undefined,
        info.name,
      ]);
    } catch {
      // No userinfo endpoint, or the IdP refused: the developer stays unlabelled.
    }
  }
  c.set("core", core);
  c.set("consumerId", String(consumer.id));
  await next();
});

const myKeys = async (core: AdminCore, consumerId: string) =>
  (await core.keyAuth.list({ where: { consumer_id: consumerId } })).data;

/**
 * Puts this consumer's staged keys live: the admin's next batch publishes
 * them (credential-only, about a second later).
 */
const goLive = (env: Env, consumerId: string) =>
  publisher(env).requestPublish(consumerId);

/** This developer's key, or not found (another developer's id included). */
async function myKey(core: AdminCore, consumerId: string, keyId: string) {
  const key = (await myKeys(core, consumerId)).find(
    (k) => String(k.id) === keyId,
  );
  if (!key) fail(ERR.ADMIN_NOT_FOUND);
  return key;
}

/**
 * A developer's key writes are rate limited by consumer: each one
 * stages a change and asks for a publish. Without the binding (an older
 * install) writes aren't limited.
 */
const writeLimit: MiddlewareHandler<{
  Bindings: Env;
  Variables: Vars;
}> = async (c, next) => {
  const binding = c.env.PORTAL_WRITES;
  if (binding) {
    const { totalHits } = await createBindingStore(binding).increment(
      c.get("consumerId"),
    );
    if (totalHits > 0) fail(ERR.RATE_LIMITED);
  }
  await next();
};
// `/api/keys/*` matches `/api/keys` too: one count per write.
api.on(["POST", "PATCH", "DELETE"], `${PORTAL_API.keys}/*`, writeLimit);

api.get(PORTAL_API.keys, async (c) =>
  c.json((await myKeys(c.get("core"), c.get("consumerId"))).map(asKey)),
);

/** Per-isolate usage answers, by consumer: when each was read, and what. */
const usageCache = new Map<string, { at: number; usage: PortalUsage }>();

/**
 * The developer's own requests and server errors per day: the query
 * names only their consumer, so nobody else's traffic is ever read. Kept
 * for a minute per isolate, so reloading the page doesn't hit the SQL API.
 */
api.get(PORTAL_API.usage, async (c) => {
  const days = ANALYTICS.portalUsageDays;
  if (!c.env.CF_ACCOUNT_ID || !c.env.AE_API_TOKEN) {
    return c.json<PortalUsage>({ configured: false, days, daily: [] });
  }
  const consumerId = c.get("consumerId");
  const cached = usageCache.get(consumerId);
  if (cached && Date.now() - cached.at < PORTAL.usageCacheMs) {
    return c.json(cached.usage);
  }
  // Consumer ids are UUIDs; anything else is never put in a query.
  const sql = consumerUsageSql(consumerId, days);
  const rows = sql
    ? await analyticsSql({
        accountId: c.env.CF_ACCOUNT_ID,
        apiToken: c.env.AE_API_TOKEN,
      })<Record<string, unknown>>(sql)
    : [];
  const usage: PortalUsage = {
    configured: true,
    days,
    // The SQL API returns 64-bit sums as strings.
    daily: rows.map((row) => ({
      day: String(row.day),
      requests: Number(row.requests),
      errors: Number(row.errors),
    })),
  };
  if (usageCache.size >= PORTAL.usageCacheEntries) usageCache.clear();
  usageCache.set(consumerId, { at: Date.now(), usage });
  return c.json(usage);
});

api.post(PORTAL_API.keys, async (c) => {
  const core = c.get("core");
  const id = c.get("consumerId");
  const name = await keyName(c.req, false);
  publisher(c.env); // fail before staging when publishing is off
  // The limit is checked in the insert's own transaction, so concurrent
  // requests can't pass it together.
  const { credential, key } = await core.keyAuth.create(
    { consumer_id: id, name },
    { maxPerConsumer: PORTAL.maxKeysPerConsumer },
  );
  await goLive(c.env, id);
  return c.json({ ...asKey(credential), key }, STATUS.created);
});

api.patch(`${PORTAL_API.keys}/:id`, async (c) => {
  const core = c.get("core");
  const keyId = c.req.param("id");
  await myKey(core, c.get("consumerId"), keyId);
  // A name isn't published: nothing goes live.
  const renamed = await core.keyAuth.rename(keyId, await keyName(c.req, true));
  return c.json(asKey(renamed));
});

api.delete(`${PORTAL_API.keys}/:id`, async (c) => {
  const core = c.get("core");
  const id = c.get("consumerId");
  const keyId = c.req.param("id");
  await myKey(core, id, keyId);
  await core.keyAuth.delete(keyId);
  await goLive(c.env, id);
  return c.body(null, STATUS.noContent);
});

// Roll one key: the same entry and name with a new value; the old
// value stops working when the batch publishes, and other keys are untouched.
api.post(`${PORTAL_API.keys}/:id/roll`, async (c) => {
  const core = c.get("core");
  const id = c.get("consumerId");
  const keyId = c.req.param("id");
  await myKey(core, id, keyId);
  publisher(c.env);
  const { credential, key } = await core.keyAuth.rotate(keyId);
  await goLive(c.env, id);
  return c.json({ ...asKey(credential), key }, STATUS.created);
});

/** An URL's origin, or undefined when it isn't one. */
const originOf = (value: string | undefined) => {
  try {
    return value ? new URL(value).origin : undefined;
  } catch {
    return undefined;
  }
};

/**
 * The origins of the endpoints an issuer's discovery document names, for the
 * CSP. Only URLs are read, so the document is fetched directly,
 * bounded by PORTAL.discoveryTimeoutMs; openid-client's discovery (`idp`)
 * is for verifying tokens.
 */
async function discoveredOrigins(issuer: string): Promise<string[]> {
  const base = issuer.endsWith(OIDC.wellKnownPath)
    ? issuer.slice(0, -OIDC.wellKnownPath.length)
    : issuer.replace(/\/+$/, "");
  const res = await fetch(`${base}${OIDC.wellKnownPath}`, {
    signal: AbortSignal.timeout(PORTAL.discoveryTimeoutMs),
  });
  if (!res.ok) {
    await res.body?.cancel();
    fail(ERR.INTERNAL); // caught by the caller: a failed discovery
  }
  const metadata = await res.json<Record<string, unknown>>();
  return [
    "authorization_endpoint",
    "token_endpoint",
    "userinfo_endpoint",
    "jwks_uri",
    "end_session_endpoint",
  ].flatMap((field) => {
    const value = metadata[field];
    return (typeof value === "string" && originOf(value)) || [];
  });
}

/** The origins each issuer's discovery document names, once discovered. */
const discovered = new Map<string, string[]>();
/** When each issuer's discovery last failed, for the CSP's back-off. */
const failedAt = new Map<string, number>();

/**
 * The origins the portal's pages may connect to besides their own:
 * PORTAL_CONNECT_SRC's (space- or comma-separated), the issuer's, and the
 * endpoints the issuer's discovery document names. A response never waits
 * for discovery: until it has succeeded in this isolate, it starts in the
 * background (`schedule`) and the issuer's origin stands in. After a failed
 * discovery it isn't started again for PORTAL.discoveryRetryMs, so an IdP
 * that is down isn't asked on every page and asset request.
 */
function connectOrigins(
  env: Env,
  schedule: (work: Promise<unknown>) => void,
): string[] {
  const origins = new Set<string>();
  for (const entry of (env.PORTAL_CONNECT_SRC ?? "").split(
    PORTAL.listSeparator,
  )) {
    const origin = originOf(entry);
    if (origin) origins.add(origin);
  }
  const issuer = originOf(env.OIDC_ISSUER);
  if (!issuer) return [...origins];
  origins.add(issuer);
  const known = discovered.get(env.OIDC_ISSUER);
  if (known) {
    for (const origin of known) origins.add(origin);
  } else if (
    Date.now() - (failedAt.get(env.OIDC_ISSUER) ?? Number.NEGATIVE_INFINITY) >=
    PORTAL.discoveryRetryMs
  ) {
    // Marked as tried now: requests until it settles don't start another.
    failedAt.set(env.OIDC_ISSUER, Date.now());
    schedule(
      discoveredOrigins(env.OIDC_ISSUER)
        .then((found) => {
          failedAt.delete(env.OIDC_ISSUER);
          discovered.set(env.OIDC_ISSUER, found);
        })
        .catch(() => {
          // Discovery failed: tried again after PORTAL.discoveryRetryMs.
          failedAt.set(env.OIDC_ISSUER, Date.now());
        }),
    );
  }
  return [...origins];
}

const app = new Hono<{ Bindings: Env }>();
app.use("*", requestIdMiddleware());
app.use("*", i18nMiddleware());
// Every response, the static site included (the Worker runs first,
// wrangler.jsonc), carries the security headers. The browser may
// connect to the IdP (its issuer and the endpoints its discovery document
// names, which can be on other hosts) and to PORTAL_CONNECT_SRC's origins:
// the API reference playground calls the API (the gateway) from the page.
app.use("*", (c, next) => {
  const csp: Record<string, string[]> = Object.fromEntries(
    Object.entries(SECURITY_HEADERS.portalCsp).map(([name, values]) => [
      name,
      [...values],
    ]),
  );
  csp.connectSrc?.push(
    ...connectOrigins(c.env, (work) => c.executionCtx.waitUntil(work)),
  );
  return secureHeaders({
    contentSecurityPolicy: csp,
    referrerPolicy: SECURITY_HEADERS.referrerPolicy,
    xContentTypeOptions: SECURITY_HEADERS.contentTypeOptions,
    xFrameOptions: SECURITY_HEADERS.frameOptions,
  })(c, next);
});
app.route("/", api);
// Everything else is the static site.
app.all("*", async (c) => {
  if (!c.env.ASSETS) return c.notFound();
  // ASSETS answers with immutable headers: copied so they can be added to.
  const res = await c.env.ASSETS.fetch(c.req.raw);
  return new Response(res.body, res);
});
app.onError(errorHandler());

export default app;
