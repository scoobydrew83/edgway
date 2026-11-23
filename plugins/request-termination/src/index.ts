/**
 * Kong's request-termination (priority 2): answer every request (or, with
 * `trigger`, only requests carrying that header or query parameter) with a
 * fixed response, without calling the upstream (register `small-kong-plugins`).
 * `body` sends a raw body; otherwise the response is an Edgway problem with
 * `status_code` and `message` as its detail; `echo` returns the request.
 */
import { HEADER, MEDIA_TYPE } from "@edgway/constants";
import { getConsumer, getRoute } from "@edgway/core";
import { ERR, problemResponse } from "@edgway/errors";
import { definePlugin } from "@edgway/plugin-sdk";
import { kongSchema } from "@edgway/schema";

const NULL_BODY = new Set([204, 205, 304]);

export default definePlugin({
  name: "request-termination",
  version: "1.0.0",
  priority: 2,
  config: kongSchema("request-termination"),
  access: (config) => async (c, next) => {
    const trigger = config.trigger;
    if (
      trigger &&
      c.req.header(trigger) === undefined &&
      c.req.query(trigger) === undefined
    ) {
      await next();
      return;
    }
    const status = config.status_code ?? ERR.REQUEST_TERMINATED.status;
    // These statuses never carry a body.
    if (NULL_BODY.has(status)) return new Response(null, { status });

    if (config.echo) {
      const url = new URL(c.req.url);
      const route = getRoute(c);
      return Response.json(
        {
          message: config.message ?? undefined,
          request: {
            scheme: url.protocol.replace(":", ""),
            host: url.hostname,
            port: url.port,
            method: c.req.method,
            path: url.pathname,
            query: Object.fromEntries(url.searchParams),
            headers: Object.fromEntries(c.req.raw.headers),
            uri_captures: route?.captures,
          },
          matched_route: route?.route,
          matched_service: route?.service,
          matched_consumer: getConsumer(c),
        },
        { status },
      );
    }
    if (config.body !== undefined && config.body !== null) {
      return new Response(config.body, {
        status,
        headers: {
          [HEADER.contentType]: config.content_type ?? MEDIA_TYPE.jsonUtf8,
        },
      });
    }
    return problemResponse(
      { ...ERR.REQUEST_TERMINATED, status },
      { detail: config.message ?? undefined },
    );
  },
});
