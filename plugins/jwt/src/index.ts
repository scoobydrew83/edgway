/**
 * Kong's jwt (priority 1450) on jose: `decodeJwt`/`decodeProtectedHeader`
 * read the token, `importSPKI` loads public keys and `compactVerify` checks
 * the signature. This file maps Kong's config onto it: where tokens come
 * from, the key claim naming the credential, the credential's algorithm,
 * `claims_to_verify` (Kong checks `exp`/`nbf` only when listed, unlike
 * jose's `jwtVerify`), `maximum_expiration`, `anonymous` and the upstream
 * consumer headers.
 *
 * Credentials come from a `JwtStore` the gateway puts on the context
 * (`setJwtStore`); HMAC secrets arrive resolved (vault references are the
 * gateway's job).
 */
import {
  DEFAULTS,
  HEADER,
  PLUGIN_CACHE,
  VAULT_REFERENCE,
  WWW_AUTHENTICATE,
} from "@edgway/constants";
import { type EdgwayError, ERR, fail, problemResponse } from "@edgway/errors";
import {
  authenticated,
  definePlugin,
  identifyAnonymous,
  identifyConsumer,
  type KongConsumer,
  type PluginConfig,
} from "@edgway/plugin-sdk";
import { kongSchema } from "@edgway/schema";
import type { Context, Next } from "hono";
import { getCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import {
  base64url,
  compactVerify,
  decodeJwt,
  decodeProtectedHeader,
  importSPKI,
  type JWTPayload,
} from "jose";

export type JwtConsumer = KongConsumer;

/** A Kong `jwt_secrets` row. */
export interface JwtCredential {
  id: string;
  consumer_id: string;
  /** Matched against the token's key claim (`iss` by default). */
  key: string;
  /** Kong's algorithm name; HS256 when unset. */
  algorithm?: string | null;
  /** HMAC secret (HS*), resolved. */
  secret?: string | null;
  /** PEM public key (RS*, ES*, PS*, EdDSA). */
  rsa_public_key?: string | null;
}

export interface JwtStore {
  /** The credential whose `key` equals the token's key claim. */
  credential(
    key: string,
  ): JwtCredential | undefined | Promise<JwtCredential | undefined>;
  /** A consumer by id or username (credential owners and `anonymous`). */
  consumer(
    idOrUsername: string,
  ): JwtConsumer | undefined | Promise<JwtConsumer | undefined>;
}

declare module "hono" {
  interface ContextVariableMap {
    edgwayJwtStore?: JwtStore;
  }
}

/** Called by the gateway before the plugins run. */
export function setJwtStore(c: Context, store: JwtStore): void {
  c.set("edgwayJwtStore", store);
}

const schema = kongSchema("jwt");
type Config = PluginConfig<typeof schema>;

const BEARER = /\s*[Bb]earer\s+(.+)/;

/** Kong's token lookup: query params, then cookies, then Bearer headers. */
function findTokens(c: Context, config: Config): string[] {
  const tokens = new Set<string>();
  const add = (token: string | undefined) => token && tokens.add(token);
  for (const name of config.uri_param_names ?? []) add(c.req.query(name));
  for (const name of config.cookie_names ?? []) add(getCookie(c, name));
  for (const name of config.header_names ?? []) {
    add(BEARER.exec(c.req.header(name) ?? "")?.[1]);
  }
  return [...tokens];
}

class Rejection {
  constructor(
    readonly error: EdgwayError,
    readonly claim?: string,
  ) {}
}
const reject = (error: EdgwayError, claim?: string): never => {
  throw new Rejection(error, claim);
};

const publicKeys = new Map<string, CryptoKey>();

async function verificationKey(
  credential: JwtCredential,
  algorithm: string,
  base64: boolean | undefined,
): Promise<CryptoKey | Uint8Array> {
  try {
    if (algorithm.startsWith("HS")) {
      // An unresolved vault reference is never a key.
      if (
        !credential.secret ||
        (credential.secret.startsWith(VAULT_REFERENCE.prefix) &&
          credential.secret.endsWith(VAULT_REFERENCE.suffix))
      ) {
        return reject(ERR.AUTH_TOKEN_INVALID_SECRET);
      }
      // Kong decodes base64 secrets as base64url, padded or not.
      return base64
        ? base64url.decode(credential.secret.replace(/=+$/, ""))
        : new TextEncoder().encode(credential.secret);
    }
    const pem = credential.rsa_public_key;
    if (!pem) return reject(ERR.AUTH_TOKEN_INVALID_SECRET);
    const cacheKey = algorithm + pem;
    let key = publicKeys.get(cacheKey);
    if (!key) {
      key = await importSPKI(pem, algorithm);
      if (publicKeys.size >= PLUGIN_CACHE.jwtPublicKeys) {
        // Evict the oldest entry (Maps iterate in insertion order).
        publicKeys.delete(publicKeys.keys().next().value as string);
      }
      publicKeys.set(cacheKey, key);
    }
    return key;
  } catch (error) {
    if (error instanceof Rejection) throw error;
    return reject(ERR.AUTH_TOKEN_INVALID_SECRET);
  }
}

/** Kong's registered-claims check: only the listed claims, as numbers. */
function verifyClaims(claims: JWTPayload, config: Config): void {
  const now = Date.now() / 1000;
  const listed = config.claims_to_verify ?? [];
  for (const claim of listed) {
    const value = claims[claim];
    if (typeof value !== "number") {
      reject(ERR.AUTH_TOKEN_CLAIM_NOT_NUMBER, claim);
    }
    if (claim === "exp" && (value as number) <= now) {
      reject(ERR.AUTH_TOKEN_EXPIRED, claim);
    }
    if (claim === "nbf" && (value as number) > now) {
      reject(ERR.AUTH_TOKEN_NOT_YET_VALID, claim);
    }
  }
  const max = config.maximum_expiration ?? 0;
  if (max > 0 && (typeof claims.exp !== "number" || claims.exp - now > max)) {
    reject(ERR.AUTH_TOKEN_EXPIRATION_TOO_LONG, "exp");
  }
}

interface Authenticated {
  credential: JwtCredential;
  consumer: JwtConsumer;
}

/** Authenticate one token; returns its credential and consumer or throws a Rejection. */
async function authenticate(
  token: string,
  config: Config,
  store: JwtStore,
): Promise<Authenticated> {
  let claims: JWTPayload;
  let header: Record<string, unknown>;
  try {
    claims = decodeJwt(token);
    header = decodeProtectedHeader(token);
  } catch {
    return reject(ERR.AUTH_TOKEN_BAD);
  }
  const claimName = config.key_claim_name;
  const keyClaim = claims[claimName] ?? header[claimName];
  if (keyClaim === undefined) {
    return reject(ERR.AUTH_TOKEN_KEY_CLAIM_MISSING, claimName);
  }
  if (typeof keyClaim !== "string" || keyClaim === "") {
    return reject(ERR.AUTH_TOKEN_KEY_CLAIM_INVALID, claimName);
  }
  const credential = await store.credential(keyClaim);
  if (!credential) return reject(ERR.AUTH_TOKEN_NO_CREDENTIALS, claimName);

  const algorithm = credential.algorithm ?? DEFAULTS.jwtAlgorithm;
  if (header.alg !== algorithm) reject(ERR.AUTH_TOKEN_INVALID_ALGORITHM);
  const key = await verificationKey(
    credential,
    algorithm,
    config.secret_is_base64,
  );
  try {
    await compactVerify(token, key, { algorithms: [algorithm] });
  } catch {
    reject(ERR.AUTH_TOKEN_INVALID_SIGNATURE);
  }
  verifyClaims(claims, config);
  const consumer = await store.consumer(credential.consumer_id);
  if (!consumer) reject(ERR.AUTH_TOKEN_CONSUMER_NOT_FOUND, claimName);
  return { credential, consumer: consumer as JwtConsumer };
}

export default definePlugin({
  name: "jwt",
  version: "1.0.0",
  priority: 1450,
  config: schema,
  enforces: "auth",
  access: (config) => {
    /**
     * Kong's 401: a plain `Bearer` challenge when no token was sent, and
     * `error="invalid_token"` for a token that was rejected.
     */
    const unauthorized = ({ error, claim }: Rejection): never => {
      const res = problemResponse(error, {
        extensions: claim ? { claim } : undefined,
      });
      res.headers.set(
        HEADER.wwwAuthenticate,
        error === ERR.AUTH_INVALID_CREDENTIALS
          ? WWW_AUTHENTICATE.bearer(config.realm)
          : WWW_AUTHENTICATE.bearerInvalidToken(config.realm),
      );
      throw new HTTPException(error.status as ContentfulStatusCode, { res });
    };

    return async (c: Context, next: Next) => {
      // Kong's logical OR: with `anonymous` set, a consumer another
      // auth plugin already identified with a credential is kept.
      if (config.anonymous && authenticated(c)) return next();
      if (c.req.method === "OPTIONS" && !config.run_on_preflight) {
        return next();
      }
      const store = c.get("edgwayJwtStore");
      if (!store) fail(ERR.INTERNAL);

      let found: Authenticated | undefined;
      let rejection: Rejection | undefined;
      try {
        const tokens = findTokens(c, config);
        if (tokens.length === 0) reject(ERR.AUTH_INVALID_CREDENTIALS);
        if (tokens.length > 1) reject(ERR.AUTH_TOKEN_MULTIPLE);
        found = await authenticate(tokens[0] as string, config, store);
      } catch (error) {
        if (!(error instanceof Rejection)) throw error;
        rejection = error;
      }

      if (found) {
        // Kong's jwt identifies the credential by its key (key-auth uses the id).
        identifyConsumer(c, found.consumer, {
          credential: found.credential.key,
        });
      } else if (config.anonymous) {
        await identifyAnonymous(
          c,
          (ref) => store.consumer(ref),
          config.anonymous,
        );
      } else {
        unauthorized(rejection as Rejection);
      }
      await next();
    };
  },
});
