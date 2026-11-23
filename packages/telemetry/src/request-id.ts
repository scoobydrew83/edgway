/**
 * Request ids via Hono's request-id middleware, on Edgway's header name.
 * An incoming x-edgway-request-id is reused; otherwise one is generated.
 */
import { HEADER } from "@edgway/constants";
import { requestId } from "hono/request-id";

export const requestIdMiddleware = () =>
  requestId({ headerName: HEADER.requestId });
