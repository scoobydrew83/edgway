/**
 * Kong's openid-connect (priority 1050), for two flows:
 * - **bearer**: `openid-client` discovers the issuer (`discovery`), and Hono's
 *   JWK verifier (`Jwt.verifyWithJwks`, the engine of `hono/jwk`) checks the
 *   token against the issuer's `jwks_uri`. Token lookup is Kong's (header,
 *   query, cookie), so the middleware's own header-only lookup is not used.
 * - **session / authorization_code**: `@hono/oidc-auth` runs the login
 *   redirect, the callback and the session cookie.
 *
 * This file maps Kong's config onto them: allowed issuers and audiences,
 * `*_required` claims, consumer mapping, upstream headers, `anonymous` and
 * `hide_credentials`. Other Kong auth methods are listed as unsupported in
 * the README. Secrets (`client_secret`, `session_secret`) arrive resolved.
 */
import {
  AUTH_SCHEME,
  HEADER,
  OIDC,
  PLUGIN_CACHE,
  PRODUCT,
  WWW_AUTHENTICATE,
} from "@edgway/constants";
import { setConsumer } from "@edgway/core";
import { type EdgwayError, ERR, fail, problemResponse } from "@edgway/errors";
import {
  authenticated,
  definePlugin,
  type IdentifyOptions,
  identifyAnonymous,
  identifyConsumer,
  type KongConsumer,
  type PluginConfig,
} from "@edgway/plugin-sdk";
import { kongSchema } from "@edgway/schema";
import {
  getAuth,
  initOidcAuthMiddleware,
  type OidcAuthEnv,
  oidcAuthMiddleware,
} from "@hono/oidc-auth";
import type { Context, Next, OidcAuthClaims } from "hono";
import { getCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { Jwt } from "hono/utils/jwt";
import { discovery, type ServerMetadata } from "openid-client";

export type OidcConsumer = KongConsumer;

/** Where openid-connect finds consumers (the published snapshot). */
export interface OidcStore {
  /** A consumer by one of Kong's `consumer_by` fields. */
  consumer(
    by: "id" | "username" | "custom_id",
    value: string,
  ): KongConsumer | undefined | Promise<KongConsumer | undefined>;
}

declare module "hono" {
  interface ContextVariableMap {
    edgwayOidcStore?: OidcStore;
  }
}

/** Called by the gateway before the plugins run. */
export function setOidcStore(c: Context, store: OidcStore): void {
  c.set("edgwayOidcStore", store);
}

const schema = kongSchema("openid-connect");
type Config = PluginConfig<typeof schema>;
type Claims = Record<string, unknown>;

/** Discovered issuers, per isolate; a failed discovery is retried next time. */
const issuers = new Map<string, Promise<ServerMetadata>>();

function discover(issuer: string, clientId: string): Promise<ServerMetadata> {
  const url = issuer.endsWith(OIDC.wellKnownPath)
    ? issuer.slice(0, -OIDC.wellKnownPath.length)
    : issuer;
  let metadata = issuers.get(url);
  if (!metadata) {
    if (issuers.size >= PLUGIN_CACHE.oidcIssuers) {
      issuers.delete(issuers.keys().next().value as string);
    }
    metadata = discovery(new URL(url), clientId).then((found) =>
      found.serverMetadata(),
    );
    metadata.catch(() => issuers.delete(url));
    issuers.set(url, metadata);
  }
  return metadata;
}

/** The value at a Kong claim path (an array of keys). */
function claimAt(claims: Claims, path: readonly string[] | null | undefined) {
  let value: unknown = claims;
  for (const key of path ?? []) {
    value = (value as Claims | undefined)?.[key];
  }
  return value;
}

/** A claim's values: a space-separated string (like `scope`) or an array. */
function claimValues(
  claims: Claims,
  path: readonly string[] | null | undefined,
): Set<string> {
  const value = claimAt(claims, path);
  if (typeof value === "string") {
    return new Set(value.split(OIDC.listSeparator).filter(Boolean));
  }
  if (Array.isArray(value)) {
    return new Set(value.filter((v): v is string => typeof v === "string"));
  }
  return new Set();
}

/** Kong's `*_required`: entries are alternatives; values within one are all required. */
function satisfies(
  required: readonly string[] | null | undefined,
  values: Set<string>,
): boolean {
  if (!required?.length) return true;
  return required.some((entry) =>
    entry
      .split(OIDC.listSeparator)
      .filter(Boolean)
      .every((value) => values.has(value)),
  );
}

type Found = { token: string; from: "header" | "query" | "cookie" };

const BEARER = /^\s*bearer\s+(\S+)\s*$/i;

/** Kong's bearer token lookup (`bearer_token_param_type`); `body` is unsupported. */
function findBearer(c: Context, config: Config): Found | undefined {
  const types = config.bearer_token_param_type ?? [];
  if (types.includes("header")) {
    const token = BEARER.exec(c.req.header(HEADER.authorization) ?? "")?.[1];
    if (token) return { token, from: "header" };
  }
  if (types.includes("query")) {
    const token = c.req.query(OIDC.accessTokenQuery);
    if (token) return { token, from: "query" };
  }
  const cookie = config.bearer_token_cookie_name;
  if (types.includes("cookie") && cookie) {
    const token = getCookie(c, cookie);
    if (token) return { token, from: "cookie" };
  }
  return undefined;
}

/** `@hono/oidc-auth`'s settings from Kong's config, or undefined if incomplete. */
function sessionEnv(config: Config): Partial<OidcAuthEnv> | undefined {
  const clientId = config.client_id?.[0];
  const clientSecret = config.client_secret?.[0];
  if (!config.session_secret || !clientId || !clientSecret) return undefined;
  return {
    OIDC_ISSUER: config.issuer.endsWith(OIDC.wellKnownPath)
      ? config.issuer.slice(0, -OIDC.wellKnownPath.length)
      : config.issuer,
    OIDC_CLIENT_ID: clientId,
    OIDC_CLIENT_SECRET: clientSecret,
    OIDC_AUTH_SECRET: config.session_secret,
    OIDC_REDIRECT_URI: config.redirect_uri?.[0],
    OIDC_SCOPES: config.scopes?.join(OIDC.listSeparator),
    OIDC_COOKIE_NAME: config.session_cookie_name ?? undefined,
    OIDC_COOKIE_PATH: config.session_cookie_path ?? undefined,
    OIDC_COOKIE_DOMAIN: config.session_cookie_domain ?? undefined,
    OIDC_AUTH_EXPIRES:
      config.session_absolute_timeout === undefined
        ? undefined
        : String(config.session_absolute_timeout),
    OIDC_AUDIENCE: config.audience?.[0],
  };
}

/** The top-level claims this config reads, kept in the session cookie. */
function sessionClaims(config: Config): string[] {
  const paths = [
    config.consumer_claim,
    config.scopes_claim,
    config.audience_claim,
    config.groups_claim,
    config.roles_claim,
    config.authenticated_groups_claim,
  ];
  const heads = paths.map((path) => path?.[0]);
  return [
    "sub",
    "iss",
    ...heads,
    ...(config.upstream_headers_claims ?? []),
  ].filter((claim): claim is string => Boolean(claim));
}

/** A claim as one header value. */
function headerValue(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.join(OIDC.claimJoin);
  return JSON.stringify(value);
}

function rewriteHeaders(c: Context, edit: (headers: Headers) => void): void {
  const headers = new Headers(c.req.raw.headers);
  edit(headers);
  c.req.raw = new Request(c.req.raw, { headers });
}

class Rejection {
  constructor(
    readonly error: EdgwayError,
    readonly tokenSent: boolean,
  ) {}
}

export default definePlugin({
  name: "openid-connect",
  version: "1.0.0",
  priority: 1050,
  config: schema,
  enforces: "auth",
  access: (config) => {
    const methods = new Set(config.auth_methods ?? []);
    const env =
      methods.has("session") || methods.has("authorization_code")
        ? sessionEnv(config)
        : undefined;
    const keep = sessionClaims(config);
    const claimHeaders = (config.upstream_headers_names ?? []).filter(
      (name): name is string => Boolean(name),
    );
    const [tokenHeader = ""] = (
      config.upstream_access_token_header ?? ""
    ).split(OIDC.headerTypeSeparator);
    /** Drop a client's copy of the access-token header. */
    const dropTokenHeader = (c: Context) => {
      if (!tokenHeader) return;
      rewriteHeaders(c, (headers) => headers.delete(tokenHeader));
    };

    return async (c: Context, next: Next) => {
      // The headers this plugin sets from claims are its alone: a client's
      // own copies never reach the upstream, on any path.
      if (claimHeaders.length > 0) {
        rewriteHeaders(c, (headers) => {
          for (const name of claimHeaders) headers.delete(name);
        });
      }
      // Kong's logical OR: with `anonymous` set, a consumer another
      // auth plugin already identified with a credential is kept.
      // Its access-token header isn't this plugin's to send then, unless
      // it's `Authorization`, the other plugin's own credential.
      if (config.anonymous && authenticated(c)) {
        if (tokenHeader.toLowerCase() !== HEADER.authorization) {
          dropTokenHeader(c);
        }
        return next();
      }
      if (c.req.method === "OPTIONS" && !config.run_on_preflight) {
        return next();
      }
      const host = new URL(c.req.url).hostname;
      const store = c.get("edgwayOidcStore");
      const needsStore = Boolean(config.consumer_claim || config.anonymous);
      if (needsStore && !store) fail(ERR.INTERNAL);

      /** Kong's 401 (or `anonymous`) and 403 responses. */
      const deny = async ({ error, tokenSent }: Rejection) => {
        if (error === ERR.AUTH_INVALID_CREDENTIALS && config.anonymous) {
          await identifyAnonymous(
            c,
            (ref) => lookup(ref, ["id", "username"]),
            config.anonymous,
          );
          // No token was accepted: none goes upstream.
          dropTokenHeader(c);
          return;
        }
        const forbidden = error === ERR.AUTH_FORBIDDEN;
        const res = problemResponse(error, {
          detail: forbidden
            ? config.forbidden_error_message
            : config.unauthorized_error_message,
        });
        if (!forbidden) {
          res.headers.set(
            HEADER.wwwAuthenticate,
            tokenSent
              ? WWW_AUTHENTICATE.bearerInvalidToken(host)
              : WWW_AUTHENTICATE.bearer(host),
          );
        }
        throw new HTTPException(error.status as 401 | 403, { res });
      };
      const lookup = async (
        value: string,
        by: readonly ("id" | "username" | "custom_id")[],
      ) => {
        for (const field of by) {
          const consumer = await store?.consumer(field, value);
          if (consumer) return consumer;
        }
        return undefined;
      };

      let claims: Claims | undefined;
      let bearer: Found | undefined;
      try {
        bearer = methods.has("bearer") ? findBearer(c, config) : undefined;
        if (bearer) {
          claims = await verifyBearer(bearer.token, config);
        } else if (env) {
          await initOidcAuthMiddleware(env)(c, async () => {});
          c.set("oidcClaimsHook", async (_orig, idToken) => {
            const kept: Record<string, OidcAuthClaims[string]> = {};
            for (const claim of keep) {
              if (idToken?.[claim] !== undefined) {
                kept[claim] = idToken[claim] as OidcAuthClaims[string];
              }
            }
            return kept as OidcAuthClaims;
          });
          const session = await getAuth(c).catch(() => null);
          if (session) claims = checkSession(session as Claims, config, env);
          else if (methods.has("authorization_code")) {
            // Redirects to the issuer, or completes the callback.
            return oidcAuthMiddleware()(c, next);
          }
        }
        if (!claims) {
          throw new Rejection(ERR.AUTH_INVALID_CREDENTIALS, false);
        }
        checkRequired(claims, config);
      } catch (error) {
        if (!(error instanceof Rejection)) throw error;
        await deny(error);
        return next();
      }

      // Consumer mapping.
      let credentialOptions: IdentifyOptions = {};
      if (bearer && config.hide_credentials) {
        credentialOptions =
          bearer.from === "query"
            ? { removeQuery: [OIDC.accessTokenQuery] }
            : bearer.from === "header"
              ? { removeHeaders: [HEADER.authorization] }
              : {};
      }
      const subject = headerValue(claims.sub);
      const consumerRef = headerValue(claimAt(claims, config.consumer_claim));
      if (config.consumer_claim) {
        const consumer = consumerRef
          ? await lookup(consumerRef, config.consumer_by ?? [])
          : undefined;
        if (consumer) {
          identifyConsumer(c, consumer, {
            ...credentialOptions,
            credential: subject ?? consumer.id,
          });
          const groups = claimValues(claims, config.authenticated_groups_claim);
          if (groups.size > 0) {
            setConsumer(c, { id: consumer.id, groups: [...groups] });
          }
        } else if (!config.consumer_optional) {
          await deny(new Rejection(ERR.AUTH_FORBIDDEN, true));
        }
      }

      // Upstream headers: the access token and mapped claims.
      const verified = claims;
      rewriteHeaders(c, (headers) => {
        if (credentialOptions.removeHeaders) {
          headers.delete(HEADER.authorization);
        }
        const [name, type] = (config.upstream_access_token_header ?? "").split(
          OIDC.headerTypeSeparator,
        );
        // Only this plugin's token is sent in it.
        if (name) headers.delete(name);
        if (bearer && name) {
          headers.set(
            name,
            type?.toLowerCase() === AUTH_SCHEME.bearer.toLowerCase()
              ? [AUTH_SCHEME.bearer, bearer.token].join(OIDC.listSeparator)
              : bearer.token,
          );
        }
        const names = config.upstream_headers_names ?? [];
        (config.upstream_headers_claims ?? []).forEach((claim, i) => {
          const header = names[i];
          const value = headerValue(verified[claim]);
          if (header && value) headers.set(header, value);
        });
      });
      if (credentialOptions.removeQuery) {
        const url = new URL(c.req.url);
        url.searchParams.delete(OIDC.accessTokenQuery);
        c.req.raw = new Request(url, c.req.raw);
      }
      await next();
    };

    async function verifyBearer(token: string, cfg: Config): Promise<Claims> {
      const metadata = await discover(
        cfg.issuer,
        cfg.client_id?.[0] ?? PRODUCT.name,
      ).catch(() => fail(ERR.INTERNAL));
      if (!metadata.jwks_uri) fail(ERR.INTERNAL);
      let claims: Claims;
      try {
        claims = await Jwt.verifyWithJwks(
          token,
          {
            jwks_uri: metadata.jwks_uri,
            allowedAlgorithms: OIDC.algorithms,
            verification: {
              exp: cfg.verify_claims,
              nbf: cfg.verify_claims,
              iat: false,
            },
          },
          // Cloudflare caches the JWKS subrequest for Kong's cache_ttl.
          { cf: { cacheTtl: cfg.cache_ttl, cacheEverything: true } },
        );
      } catch {
        throw new Rejection(ERR.AUTH_INVALID_CREDENTIALS, true);
      }
      const allowed = cfg.issuers_allowed?.length
        ? cfg.issuers_allowed
        : [metadata.issuer];
      if (cfg.verify_claims && !allowed.includes(String(claims.iss))) {
        throw new Rejection(ERR.AUTH_INVALID_CREDENTIALS, true);
      }
      if (cfg.verify_claims) checkAudience(claims, cfg);
      return claims;
    }
  },
});

/**
 * The token must be for this client: `audience`, or else the client ids
 * (Kong's fallback). A token the IdP issued for another application is
 * refused.
 */
function checkAudience(claims: Claims, config: Config): void {
  const audiences = claimValues(claims, config.audience_claim);
  const expected = config.audience?.length ? config.audience : config.client_id;
  if (expected?.length && !expected.some((aud) => audiences.has(aud))) {
    throw new Rejection(ERR.AUTH_INVALID_CREDENTIALS, true);
  }
}

/**
 * A session cookie's claims, if this instance issued them: another
 * openid-connect instance sharing the session secret and cookie name, but
 * with another issuer or client, can't hand its sessions over. Checked even
 * with `verify_claims` off (unlike a bearer token's): the cookie is ours, so
 * its issuer and client are never a claim to skip.
 */
function checkSession(
  claims: Claims,
  config: Config,
  env: Partial<OidcAuthEnv>,
): Claims {
  const trim = (issuer: string) => issuer.replace(/\/+$/, "");
  const allowed = (
    config.issuers_allowed?.length
      ? config.issuers_allowed
      : [env.OIDC_ISSUER ?? config.issuer]
  ).map(trim);
  if (!allowed.includes(trim(String(claims.iss ?? "")))) {
    throw new Rejection(ERR.AUTH_INVALID_CREDENTIALS, true);
  }
  checkAudience(claims, config);
  return claims;
}

/** Kong's audience, scope, group and role requirements: 403 when unmet. */
function checkRequired(claims: Claims, config: Config): void {
  const requirements: [
    readonly string[] | null | undefined,
    readonly string[] | null | undefined,
  ][] = [
    [config.audience_required, config.audience_claim],
    [config.scopes_required, config.scopes_claim],
    [config.groups_required, config.groups_claim],
    [config.roles_required, config.roles_claim],
  ];
  for (const [required, path] of requirements) {
    if (!satisfies(required, claimValues(claims, path))) {
      throw new Rejection(ERR.AUTH_FORBIDDEN, true);
    }
  }
}
