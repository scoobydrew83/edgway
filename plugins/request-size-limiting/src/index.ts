/**
 * Kong's request-size-limiting (priority 951) on hono/body-limit, without
 * ever buffering a body (CLAUDE.md §4):
 * - With `Content-Length`, hono/body-limit rejects an oversized request
 *   before anything is read.
 * - Without it (chunked), hono/body-limit would buffer the whole body, so the
 *   body is streamed through a byte counter instead. Past the limit the stream
 *   fails, which cuts the upload short, and `header_filter` answers with
 *   Kong's 413 whatever the upstream returned.
 * `require_content_length` answers 411 when the header is missing.
 */
import { HEADER, SIZE_UNIT_BYTES } from "@edgway/constants";
import { type EdgwayError, ERR, problemResponse } from "@edgway/errors";
import { definePlugin } from "@edgway/plugin-sdk";
import { kongSchema } from "@edgway/schema";
import type { Context, Next } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";

declare module "hono" {
  interface ContextVariableMap {
    /** Set when a streamed body went past the limit. */
    edgwayBodyTooLarge?: boolean;
  }
}

const reject = (error: EdgwayError): never => {
  throw new HTTPException(error.status as ContentfulStatusCode, {
    res: problemResponse(error),
  });
};

/** The error a streamed body fails with once past the limit. */
export class BodyTooLarge extends HTTPException {
  override name = "BodyTooLarge";
  constructor() {
    super(ERR.REQUEST_TOO_LARGE.status as ContentfulStatusCode, {
      res: problemResponse(ERR.REQUEST_TOO_LARGE),
    });
  }
}

/**
 * The body, counted as it streams; past `maxSize` the stream fails, so the
 * upload to the upstream is aborted rather than delivered truncated.
 */
function limitBody(
  c: Context,
  body: ReadableStream<Uint8Array>,
  maxSize: number,
): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let size = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      size += value.byteLength;
      if (size > maxSize) {
        c.set("edgwayBodyTooLarge", true);
        await reader.cancel();
        controller.error(new BodyTooLarge());
        return;
      }
      controller.enqueue(value);
    },
    cancel: (reason) => reader.cancel(reason),
  });
}

export default definePlugin({
  name: "request-size-limiting",
  version: "1.0.0",
  priority: 951,
  // A broken policy blocks the request.
  enforces: "policy",
  config: kongSchema("request-size-limiting"),
  access: (config) => {
    const maxSize =
      (config.allowed_payload_size ?? 0) *
      SIZE_UNIT_BYTES[config.size_unit ?? "megabytes"];
    const byLength = bodyLimit({
      maxSize,
      onError: () => reject(ERR.REQUEST_TOO_LARGE),
    });

    return async (c: Context, next: Next) => {
      const body = c.req.raw.body;
      const hasLength =
        c.req.header(HEADER.contentLength) !== undefined &&
        c.req.header(HEADER.transferEncoding) === undefined;
      if (!hasLength && config.require_content_length) {
        reject(ERR.CONTENT_LENGTH_REQUIRED);
      }
      if (!body || hasLength) {
        // hono/body-limit checks Content-Length without reading the body.
        await byLength(c, next);
        return;
      }
      c.req.raw = new Request(c.req.raw, {
        body: limitBody(c, body, maxSize),
        duplex: "half",
      } as RequestInit);
      await next();
    };
  },
  header_filter: () => (c) => {
    if (c.get("edgwayBodyTooLarge")) {
      c.res.body?.cancel().catch(() => {});
      // Cleared first, so Hono does not copy the upstream's headers across.
      c.res = undefined as unknown as Response;
      c.res = problemResponse(ERR.REQUEST_TOO_LARGE);
    }
  },
});
