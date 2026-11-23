/**
 * Kong's key-auth (priority 1250) on hono/bearer-auth: bearer-auth reads and
 * verifies header keys (custom header name, no prefix, `verifyToken`); this
 * file maps Kong's config onto it and adds Kong's query-string keys, the
 * `anonymous` fallback, `hide_credentials` and the upstream consumer headers.
 *
 * Keys are looked up by SHA-256 hash in a `KeyAuthStore` the gateway puts on
 * the context (`setKeyAuthStore`); raw keys are never stored.
 */
import { API_KEY, HEADER, WWW_AUTHENTICATE } from "@edgway/constants";
import { sha256Hex } from "@edgway/core";
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
import type { Context, Next } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { nanoid } from "nanoid";

export type KeyAuthConsumer = KongConsumer;

export interface KeyAuthCredential {
  id: string;
  consumer_id: string;
  /** Epoch seconds (Kong's credential `ttl`); an expired key never matches. */
  expires_at?: number | null;
}

/** Where key-auth finds credentials and consumers (the published snapshot). */
export interface KeyAuthStore {
  /** The credential whose key hashes (SHA-256 hex) to `keyHash`. */
  credential(
    keyHash: string,
  ): KeyAuthCredential | undefined | Promise<KeyAuthCredential | undefined>;
  /** A consumer by id or username (credential owners and `anonymous`). */
  consumer(
    idOrUsername: string,
  ): KeyAuthConsumer | undefined | Promise<KeyAuthConsumer | undefined>;
}

declare module "hono" {
  interface ContextVariableMap {
    edgwayKeyAuthStore?: KeyAuthStore;
  }
}

/** Called by the gateway before the plugins run. */
export function setKeyAuthStore(c: Context, store: KeyAuthStore): void {
  c.set("edgwayKeyAuthStore", store);
}

/** A new key, shown once; store only `sha256Hex(key)` and `keyDisplayPrefix(key)`. */
export function generateKey(): string {
  return API_KEY.prefix + nanoid(API_KEY.randomChars);
}

export function keyDisplayPrefix(key: string): string {
  return key.slice(0, API_KEY.displayPrefixLength);
}

const schema = kongSchema("key-auth");
type Config = PluginConfig<typeof schema>;

type Found =
  | { key: string; name: string; in: "header" | "query" }
  | { duplicate: true };

/** Kong's lookup: for each key name, the header, then the query string. */
function findKey(c: Context, config: Config): Found | undefined {
  for (const name of config.key_names ?? []) {
    const header = config.key_in_header ? c.req.header(name) : undefined;
    if (header) return { key: header, name, in: "header" };
    const query = config.key_in_query ? c.req.queries(name) : undefined;
    if (query && query.length > 1) return { duplicate: true };
    if (query?.[0]) return { key: query[0], name, in: "query" };
  }
  return undefined;
}

/** `hide_credentials`: where the key was found, to strip it upstream. */
function hidden(found: Found | undefined): IdentifyOptions {
  if (!found || !("name" in found)) return {};
  return found.in === "header"
    ? { removeHeaders: [found.name] }
    : { removeQuery: [found.name] };
}

export default definePlugin({
  name: "key-auth",
  version: "1.0.0",
  priority: 1250,
  config: schema,
  enforces: "auth",
  access: (config) => {
    const challenge = WWW_AUTHENTICATE.key(config.realm);
    /** Kong's 401: the error with a `WWW-Authenticate` challenge. */
    const reject = (error: EdgwayError): never => {
      const res = problemResponse(error);
      res.headers.set(HEADER.wwwAuthenticate, challenge);
      throw new HTTPException(error.status as ContentfulStatusCode, { res });
    };

    return async (c: Context, next: Next) => {
      // Kong's logical OR: with `anonymous` set, a consumer another
      // auth plugin already identified with a credential is kept.
      if (config.anonymous && authenticated(c)) return next();
      if (c.req.method === "OPTIONS" && !config.run_on_preflight) {
        return next();
      }
      const store = c.get("edgwayKeyAuthStore");
      if (!store) fail(ERR.INTERNAL);

      const found = findKey(c, config);
      const hide = config.hide_credentials ? hidden(found) : {};
      const anonymous = () =>
        identifyAnonymous(
          c,
          (ref) => store.consumer(ref),
          config.anonymous ?? "",
          hide,
        );
      const unmatched = async () => {
        if (!config.anonymous) reject(ERR.AUTH_INVALID_CREDENTIALS);
        await anonymous();
      };
      /** Authenticate a key; without a match, fall back to `anonymous` or reject. */
      const verify = async (key: string) => {
        const credential = await store.credential(await sha256Hex(key));
        const live =
          credential &&
          !(
            credential.expires_at && credential.expires_at * 1000 <= Date.now()
          );
        const consumer = live
          ? await store.consumer(credential.consumer_id)
          : undefined;
        if (live && !consumer) fail(ERR.INTERNAL);
        if (live && consumer) {
          identifyConsumer(c, consumer, { ...hide, credential: credential.id });
        } else await unmatched();
        return true;
      };

      if (!found || "duplicate" in found) {
        if (!config.anonymous) {
          reject(found ? ERR.AUTH_KEY_DUPLICATE : ERR.AUTH_KEY_MISSING);
        }
        await anonymous();
        return next();
      }
      if (found.in === "query") {
        await verify(found.key);
        return next();
      }
      let verified = false;
      try {
        await bearerAuth({
          headerName: found.name,
          prefix: "",
          verifyToken: async (key) => (verified = await verify(key)),
        })(c, next);
      } catch (error) {
        // bearer-auth's 400 for a key outside token68: Kong treats it as a bad key.
        const malformed =
          error instanceof HTTPException && error.status === 400;
        if (verified || !malformed) throw error;
        await unmatched();
        return next();
      }
    };
  },
});
