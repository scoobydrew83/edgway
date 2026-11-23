/**
 * Kong's ip-restriction (priority 990) on hono/ip-restriction: IPs and CIDRs
 * in `deny` block first, then anything outside a non-empty `allow` blocks.
 * The client IP is Cloudflare's `CF-Connecting-IP`, which the edge sets and
 * clients cannot forge. This file maps Kong's config onto it and answers
 * with Kong's message, or the configured `status` and `message`.
 */
import { HEADER } from "@edgway/constants";
import { ERR, fail, problemResponse } from "@edgway/errors";
import { definePlugin } from "@edgway/plugin-sdk";
import { kongSchema } from "@edgway/schema";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { ipRestriction } from "hono/ip-restriction";
import type { ContentfulStatusCode } from "hono/utils/http-status";

const clientIp = (c: Context) => c.req.header(HEADER.clientIp) ?? "";

export default definePlugin({
  name: "ip-restriction",
  version: "1.0.0",
  priority: 990,
  // A broken policy blocks the request.
  enforces: "policy",
  config: kongSchema("ip-restriction"),
  access: (config) => {
    const status = (config.status ??
      ERR.IP_NOT_ALLOWED.status) as ContentfulStatusCode;
    const ours = new WeakSet<HTTPException>();
    /** Kong's rejection: its default 403 message, or the configured one. */
    const blocked = () => {
      const error = new HTTPException(status, {
        res: problemResponse(
          { ...ERR.IP_NOT_ALLOWED, status },
          { detail: config.message ?? undefined },
        ),
      });
      ours.add(error);
      return error;
    };
    const middleware = ipRestriction(
      clientIp,
      { denyList: config.deny ?? [], allowList: config.allow ?? [] },
      () => {
        throw blocked();
      },
    );
    return async (c, next) => {
      if (!config.allow?.length && !config.deny?.length) fail(ERR.INTERNAL);
      if (!clientIp(c)) fail(ERR.IP_UNKNOWN);
      let passed = false;
      try {
        await middleware(c, async () => {
          passed = true;
          await next();
        });
      } catch (error) {
        // hono's own 403 for an address it cannot parse: Kong's "not allowed".
        if (passed || !(error instanceof HTTPException) || ours.has(error)) {
          throw error;
        }
        throw blocked();
      }
    };
  },
});
