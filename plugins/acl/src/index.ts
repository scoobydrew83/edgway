/**
 * Kong's acl (priority 950): allow or deny the authenticated consumer by its
 * groups (register `small-kong-plugins`: an allow/deny check with no library
 * to wrap). Groups come from an `AclStore` the gateway puts on the context
 * (Kong's `acls` entity, plus consumer groups with `include_consumer_groups`),
 * or from the groups an auth plugin authenticated (openid-connect's
 * `authenticated_groups_claim`).
 */
import { ACL, HEADER } from "@edgway/constants";
import { getConsumer } from "@edgway/core";
import { ERR, fail } from "@edgway/errors";
import { definePlugin } from "@edgway/plugin-sdk";
import { kongSchema } from "@edgway/schema";
import type { Context, Next } from "hono";

type Groups = readonly string[];

export interface AclStore {
  /** The consumer's groups (Kong's `acls` entity). */
  groups(consumerId: string): Groups | Promise<Groups>;
  /** The names of the consumer groups the consumer belongs to. */
  consumerGroups?(consumerId: string): Groups | Promise<Groups>;
}

declare module "hono" {
  interface ContextVariableMap {
    edgwayAclStore?: AclStore;
  }
}

/** Called by the gateway before the plugins run. */
export function setAclStore(c: Context, store: AclStore): void {
  c.set("edgwayAclStore", store);
}

export default definePlugin({
  name: "acl",
  version: "1.0.0",
  priority: 950,
  // A broken policy blocks the request.
  enforces: "policy",
  config: kongSchema("acl"),
  access: (config) => {
    const allow = config.allow ?? undefined;
    const deny = config.deny ?? [];

    return async (c: Context, next: Next) => {
      // Kong requires one of allow or deny; fail closed if neither is set.
      if (!allow && deny.length === 0) fail(ERR.INTERNAL);
      const consumer = getConsumer(c);
      if (!consumer) fail(ERR.AUTH_INVALID_CREDENTIALS);

      // Kong uses authenticated groups only for the anonymous consumer, or
      // always with always_use_authenticated_groups.
      // The consumer says so, not a request header another plugin could set
      //.
      const anonymous = consumer.anonymous === true;
      const authenticated =
        (config.always_use_authenticated_groups || anonymous) &&
        consumer.groups?.length
          ? consumer.groups
          : undefined;

      let groups: Groups;
      if (authenticated) {
        groups = authenticated;
      } else {
        const store = c.get("edgwayAclStore");
        if (!store) fail(ERR.INTERNAL);
        groups = [
          ...(await store.groups(consumer.id)),
          ...(config.include_consumer_groups && store.consumerGroups
            ? await store.consumerGroups(consumer.id)
            : []),
        ];
      }

      const blocked = allow
        ? !groups.some((group) => allow.includes(group))
        : groups.some((group) => deny.includes(group));
      if (blocked) fail(ERR.ACL_FORBIDDEN);

      // Kong sends the consumer's groups as X-Consumer-Groups, and
      // authenticated groups as X-Authenticated-Groups.
      const header = authenticated
        ? HEADER.authenticatedGroups
        : HEADER.consumerGroups;
      const headers = new Headers(c.req.raw.headers);
      headers.delete(HEADER.consumerGroups);
      if (!config.hide_groups_header && groups.length > 0) {
        headers.set(header, groups.join(ACL.groupsJoin));
      }
      c.req.raw = new Request(c.req.raw, { headers });
      await next();
    };
  },
});
