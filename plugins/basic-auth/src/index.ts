/**
 * Kong's basic-auth (priority 1100) on hono/basic-auth: the middleware parses
 * `Authorization` and calls `verifyUser`; `Proxy-Authorization`, which Kong
 * reads first, is parsed with Hono's own basic-auth parser. This file maps
 * Kong's config onto it and checks passwords in Kong's stored format,
 * `sha1(password .. consumer_id)` as hex, so passwords imported with decK
 * keep working.
 */
import { HEADER, WWW_AUTHENTICATE } from "@edgway/constants";
import { sha1Hex } from "@edgway/core";
import { ERR, fail, problemResponse } from "@edgway/errors";
import {
  authenticated,
  definePlugin,
  identifyAnonymous,
  identifyConsumer,
  type KongConsumer,
} from "@edgway/plugin-sdk";
import { kongSchema } from "@edgway/schema";
import type { Context, Next } from "hono";
import { basicAuth } from "hono/basic-auth";
import { HTTPException } from "hono/http-exception";
import { auth } from "hono/utils/basic-auth";
import { timingSafeEqual } from "hono/utils/buffer";

export type BasicAuthConsumer = KongConsumer;

/** A Kong `basicauth_credentials` row; `password` is Kong's hash. */
export interface BasicAuthCredential {
  id: string;
  consumer_id: string;
  username: string;
  /** `sha1(password .. consumer_id)` as lower-case hex (Kong's format). */
  password: string;
}

export interface BasicAuthStore {
  credential(
    username: string,
  ): BasicAuthCredential | undefined | Promise<BasicAuthCredential | undefined>;
  /** A consumer by id or username (credential owners and `anonymous`). */
  consumer(
    idOrUsername: string,
  ): KongConsumer | undefined | Promise<KongConsumer | undefined>;
}

declare module "hono" {
  interface ContextVariableMap {
    edgwayBasicAuthStore?: BasicAuthStore;
  }
}

/** Called by the gateway before the plugins run. */
export function setBasicAuthStore(c: Context, store: BasicAuthStore): void {
  c.set("edgwayBasicAuthStore", store);
}

/** Kong's stored password hash for a consumer. */
export function hashPassword(
  password: string,
  consumerId: string,
): Promise<string> {
  return sha1Hex(password + consumerId);
}

/** Parse a Basic credential from any header, with Hono's parser. */
function parse(value: string | undefined) {
  if (!value) return undefined;
  return auth(
    new Request("https://parse.invalid", {
      headers: { [HEADER.authorization]: value },
    }),
  );
}

export default definePlugin({
  name: "basic-auth",
  version: "1.0.0",
  priority: 1100,
  config: kongSchema("basic-auth"),
  enforces: "auth",
  access: (config) => {
    const realm = config.realm ?? "";
    const hide = config.hide_credentials
      ? { removeHeaders: [HEADER.authorization, HEADER.proxyAuthorization] }
      : {};

    return async (c: Context, next: Next) => {
      // Kong's logical OR: with `anonymous` set, a consumer another
      // auth plugin already identified with a credential is kept.
      if (config.anonymous && authenticated(c)) return next();
      const store = c.get("edgwayBasicAuthStore");
      if (!store) fail(ERR.INTERNAL);

      /** Kong's single failure: 401 Unauthorized, or the anonymous consumer. */
      const unmatched = async () => {
        if (!config.anonymous) {
          const res = problemResponse(ERR.AUTH_INVALID_CREDENTIALS);
          res.headers.set(
            HEADER.wwwAuthenticate,
            WWW_AUTHENTICATE.basic(realm),
          );
          throw new HTTPException(401, { res });
        }
        await identifyAnonymous(
          c,
          (ref) => store.consumer(ref),
          config.anonymous,
          hide,
        );
      };
      /** Check a password against a credential; identify or fall back. */
      const check = async (
        credential: BasicAuthCredential | undefined,
        password: string,
      ) => {
        const valid =
          credential &&
          (await timingSafeEqual(
            credential.password,
            await hashPassword(password, credential.consumer_id),
          ));
        // Awaited, not returned: a returned rejected promise is only adopted a
        // tick later, which workerd reports as an unhandled rejection.
        if (!valid) {
          await unmatched();
          return;
        }
        const consumer = await store.consumer(credential.consumer_id);
        if (!consumer) fail(ERR.INTERNAL);
        identifyConsumer(c, consumer, {
          ...hide,
          // Kong's basic-auth identifies the credential by its username.
          credential: credential.username,
        });
      };

      // Kong tries Proxy-Authorization first, then Authorization.
      const proxy = parse(c.req.header(HEADER.proxyAuthorization));
      const proxied = proxy && (await store.credential(proxy.username));
      if (proxy && proxied) {
        await check(proxied, proxy.password);
        return next();
      }

      let verified = false;
      try {
        await basicAuth({
          realm,
          verifyUser: async (username, password) => {
            verified = true;
            await check(await store.credential(username), password);
            return true;
          },
        })(c, next);
      } catch (error) {
        // hono/basic-auth's own 401: no or unparsable Authorization header.
        if (verified || !(error instanceof HTTPException)) throw error;
        await unmatched();
        return next();
      }
    };
  },
});
