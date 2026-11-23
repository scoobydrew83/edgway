import { type HttpLogDelivery, retryHttpLog } from "@edgway/adapters-cf";
import { GATEWAY_ENDPOINTS, PRODUCT } from "@edgway/constants";
import { ERR, errorHandler } from "@edgway/errors";
import { i18nMiddleware } from "@edgway/i18n";
import * as telemetry from "@edgway/telemetry";
import { Hono } from "hono";
import { dataPlane, type Env } from "./data-plane";

// Durable Object class for wrangler (rate-limiting's counters).
export { RateLimitCounter } from "@edgway/adapters-cf";

telemetry.configureLogging();
const log = telemetry.getLogger("gateway");

const app = new Hono<{ Bindings: Env }>();

// Tag every request with x-edgway-request-id, then resolve its locale
// (Accept-Language) before anything can fail.
app.use("*", telemetry.requestIdMiddleware());
app.use("*", i18nMiddleware());

// The gateway's own endpoints, under a reserved prefix.
app.get(GATEWAY_ENDPOINTS.info, (c) =>
  c.json({ name: PRODUCT.name, health: GATEWAY_ENDPOINTS.health }),
);
app.get(GATEWAY_ENDPOINTS.health, (c) =>
  c.json({ ok: true, service: PRODUCT.name, ts: new Date().toISOString() }),
);

// Everything else is the data plane (no D1 on the request path).
app.all("*", dataPlane);

const handleError = errorHandler();
app.onError(async (err, c) => {
  const res = await handleError(err, c);
  // Expected problems (4xx) are the client's business; log only server errors.
  if (res.status >= ERR.INTERNAL.status) {
    log.error(telemetry.EVENT.unhandledError, {
      [telemetry.ATTR_ERROR_TYPE]: err.name,
      [telemetry.ATTR_HTTP_REQUEST_METHOD]: c.req.method,
      [telemetry.ATTR_URL_PATH]: c.req.path,
      [telemetry.ATTR_EDGWAY_REQUEST_ID]: c.get("requestId"),
      [telemetry.ATTR_EXCEPTION_MESSAGE]: err.message,
      [telemetry.ATTR_EXCEPTION_STACKTRACE]: err.stack,
    });
  }
  return res;
});

export default {
  fetch: app.fetch,
  // http-log's retry buffer (the optional HTTP_LOG_RETRY queue).
  queue: (batch) => retryHttpLog(batch),
} satisfies ExportedHandler<Env, HttpLogDelivery>;
