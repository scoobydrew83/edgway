/**
 * RFC 9457 problem+json responses for Edgway errors, built on
 * hono-problem-details. Callers pass an ERR entry, never a string or status.
 */
import { HEADER, MEDIA_TYPE } from "@edgway/constants";
import { t } from "@edgway/i18n";
import type { ErrorHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import {
  ProblemDetailsError,
  problemDetails,
  problemDetailsHandler,
} from "hono-problem-details";
import { type EdgwayError, ERR, problemType } from "./registry.js";

export interface ProblemOptions {
  /** Occurrence-specific explanation (RFC 9457 `detail`). */
  detail?: string;
  /** Extra members, flattened into the body. */
  extensions?: Record<string, unknown>;
}

function toProblem(error: EdgwayError, options: ProblemOptions = {}) {
  return problemDetails({
    status: error.status,
    type: problemType(error),
    title: t(error.message),
    detail: options.detail,
    extensions: { ...options.extensions, code: error.code },
  });
}

/** Throw an Edgway error; the error handler turns it into problem+json. */
export function fail(error: EdgwayError, options?: ProblemOptions): never {
  throw toProblem(error, options);
}

/** Build a problem+json Response directly, e.g. to add headers before returning it. */
export function problemResponse(
  error: EdgwayError,
  options?: ProblemOptions,
): Response {
  return toProblem(error, options).getResponse();
}

export type ErrorFormat = "problem" | "kong";

export interface ErrorHandlerOptions {
  /**
   * `problem` (default): RFC 9457 application/problem+json.
   * `kong`: Kong's `{"message": "..."}` shape for clients that already parse it.
   */
  format?: ErrorFormat;
}

/**
 * Hono `app.onError` handler: every error leaves as an Edgway problem. A Hono
 * `HTTPException` keeps its status; one carrying its own response (e.g. a
 * problem with a `WWW-Authenticate` challenge) is sent as is.
 */
export function errorHandler(options: ErrorHandlerOptions = {}): ErrorHandler {
  const problem = problemDetailsHandler({
    // Unexpected errors map to EDG-CFG-500 without leaking internals; an
    // HTTPException is rendered by hono-problem-details with its own status.
    mapError: (err) =>
      err instanceof ProblemDetailsError || err instanceof HTTPException
        ? undefined
        : {
            status: ERR.INTERNAL.status,
            type: problemType(ERR.INTERNAL),
            title: t(ERR.INTERNAL.message),
            extensions: { code: ERR.INTERNAL.code },
          },
  });
  const handler: ErrorHandler = (err, c) =>
    err instanceof HTTPException && err.res
      ? err.getResponse()
      : problem(err, c);
  if (options.format !== "kong") return handler;

  return async (err, c) => {
    const res = await handler(err, c);
    if (
      !res.headers.get(HEADER.contentType)?.includes(MEDIA_TYPE.problemJson)
    ) {
      return res;
    }
    const body = (await res.json()) as { title: string };
    const kong = c.json(
      { message: body.title },
      res.status as ContentfulStatusCode,
    );
    // Keep challenge and other headers (e.g. WWW-Authenticate).
    res.headers.forEach((value, name) => {
      if (name !== HEADER.contentType && name !== HEADER.contentLength) {
        kong.headers.set(name, value);
      }
    });
    return kong;
  };
}
