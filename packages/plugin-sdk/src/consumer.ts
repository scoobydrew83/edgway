/**
 * Kong's consumer identification for auth plugins: set the consumer, send
 * Kong's upstream consumer headers (replacing client-sent copies) and,
 * with `hide_credentials`, strip the credential before the request goes
 * upstream. Also the `anonymous` fallback every Kong auth plugin shares.
 */
import { HEADER } from "@edgway/constants";
import { getConsumer, setConsumer } from "@edgway/core";
import { ERR, fail } from "@edgway/errors";
import type { Context } from "hono";

/** A Kong consumer, as auth plugins report it upstream. */
export interface KongConsumer {
  id: string;
  username?: string | null;
  custom_id?: string | null;
}

export interface IdentifyOptions {
  /**
   * How the plugin names the credential in `X-Credential-Identifier`
   * (key-auth: its id; jwt: its key; basic-auth: its username). Leave it
   * unset for the anonymous consumer.
   */
  credential?: string;
  /** Request headers to remove (`hide_credentials`). */
  removeHeaders?: readonly string[];
  /** Query parameters to remove (`hide_credentials`). */
  removeQuery?: readonly string[];
}

/** Set the authenticated consumer and Kong's upstream consumer headers. */
export function identifyConsumer(
  c: Context,
  consumer: KongConsumer,
  options: IdentifyOptions = {},
): void {
  setConsumer(
    c,
    options.credential === undefined
      ? { id: consumer.id, anonymous: true }
      : { id: consumer.id },
  );
  const url = new URL(c.req.url);
  const headers = new Headers(c.req.raw.headers);
  const set = (name: string, value: string | null | undefined) =>
    value ? headers.set(name, value) : headers.delete(name);
  set(HEADER.consumerId, consumer.id);
  set(HEADER.consumerCustomId, consumer.custom_id);
  set(HEADER.consumerUsername, consumer.username);
  set(HEADER.credentialIdentifier, options.credential);
  set(
    HEADER.anonymousConsumer,
    options.credential === undefined ? String(true) : undefined,
  );
  for (const name of options.removeHeaders ?? []) headers.delete(name);
  for (const name of options.removeQuery ?? []) url.searchParams.delete(name);
  c.req.raw = new Request(url, new Request(c.req.raw, { headers }));
}

/** Kong's `anonymous` fallback: a consumer by id or username, or a 500. */
export async function identifyAnonymous(
  c: Context,
  lookup: (
    idOrUsername: string,
  ) => KongConsumer | undefined | Promise<KongConsumer | undefined>,
  idOrUsername: string,
  options: Omit<IdentifyOptions, "credential"> = {},
): Promise<void> {
  const consumer = await lookup(idOrUsername);
  if (!consumer) fail(ERR.INTERNAL);
  identifyConsumer(c, consumer, options);
}

/**
 * Whether an earlier auth plugin already identified a consumer with a
 * credential (not the anonymous fallback). Kong's "logical OR" between auth
 * plugins: one configured with `anonymous` is skipped then, so it
 * can't replace the real consumer with the anonymous one.
 */
export function authenticated(c: Context): boolean {
  const consumer = getConsumer(c);
  return consumer !== undefined && consumer.anonymous !== true;
}
