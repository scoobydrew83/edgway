/**
 * Kong's http-log (priority 12): after the response, send Kong's log entry
 * (the basic serializer's shape) to `http_endpoint`. The runner runs the log
 * phase inside `waitUntil`, so the client never waits for it. Plugins don't
 * call `fetch` themselves (the `no-bare-fetch` gate): the gateway supplies the
 * transport (fetch through @edgway/adapters-cf) and an optional retry queue
 * (Cloudflare Queues), whose consumer retries a failed delivery with backoff.
 */
import { AUTHORIZATION, HEADER, HTTP_LOG, MEDIA_TYPE } from "@edgway/constants";
import { getConsumer, getCredentialNames, getRoute } from "@edgway/core";
import { definePlugin } from "@edgway/plugin-sdk";
import { kongSchema } from "@edgway/schema";
import type { Context } from "hono";

/** A delivery the retry queue's consumer sends again. */
export interface HttpLogDelivery {
  endpoint: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

/** The retry buffer: a Cloudflare Queue producer, or anything with `send`. */
export interface HttpLogQueue {
  send(delivery: HttpLogDelivery): Promise<void>;
}

/** Sends one delivery; resolves to whether the endpoint accepted it (2xx). */
export interface HttpLogTransport {
  deliver(delivery: HttpLogDelivery, timeoutMs: number): Promise<boolean>;
}

declare module "hono" {
  interface ContextVariableMap {
    edgwayHttpLogTransport?: HttpLogTransport;
    edgwayHttpLogQueue?: HttpLogQueue;
    /** When the request reached the plugin (Kong's `started_at`). */
    edgwayHttpLogStartedAt?: number;
  }
}

/** Called by the gateway before the plugins run. */
export function setHttpLogTransport(
  c: Context,
  transport: HttpLogTransport,
): void {
  c.set("edgwayHttpLogTransport", transport);
}

/** Called by the gateway before the plugins run, when a retry queue is bound. */
export function setHttpLogQueue(c: Context, queue: HttpLogQueue): void {
  c.set("edgwayHttpLogQueue", queue);
}

/**
 * The header and query names never logged: the defaults, plus the names the
 * published config's auth plugins read credentials from.
 */
function redactions(c: Context) {
  const names = getCredentialNames(c);
  return {
    headers: new Set<string>([
      ...HTTP_LOG.redactedHeaders,
      ...(names?.headers ?? []),
    ]),
    query: new Set<string>([
      ...HTTP_LOG.redactedQueryParams,
      ...(names?.query ?? []),
    ]),
  };
}
type Redactions = ReturnType<typeof redactions>;

function headersOf(
  headers: Headers,
  redact: Redactions,
): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, name) => {
    out[name] = redact.headers.has(name) ? HTTP_LOG.redacted : value;
  });
  return out;
}

/** A URL (or path and query) with its credential query parameters redacted. */
function redactQuery(url: URL, redact: Redactions): URL {
  const names = [...url.searchParams.keys()];
  const hidden = (name: string) => redact.query.has(name.toLowerCase());
  // Untouched unless something is redacted: rewriting the query re-encodes
  // the other parameters.
  if (!names.some(hidden)) return url;
  const out = new URL(url);
  for (const name of names) {
    if (hidden(name)) out.searchParams.set(name, HTTP_LOG.redacted);
  }
  return out;
}

/** The upstream path and query, with its query redacted the same way. */
function redactPath(
  path: string | undefined,
  redact: Redactions,
): string | undefined {
  if (path === undefined) return undefined;
  // Any base will do: only the path and query are kept.
  const url = redactQuery(new URL(path, "http://path.invalid"), redact);
  return url.pathname + url.search;
}

const size = (headers: Headers) =>
  Number(headers.get(HEADER.contentLength) ?? 0);

/** Kong's basic log serializer entry, from what a Worker can observe. */
function entry(c: Context) {
  const redact = redactions(c);
  const url = redactQuery(new URL(c.req.url), redact);
  const now = Date.now();
  const startedAt = c.get("edgwayHttpLogStartedAt") ?? now;
  const route = getRoute(c);
  const consumer = getConsumer(c);
  const credential = c.req.header(HEADER.credentialIdentifier);
  return {
    request: {
      method: c.req.method,
      uri: url.pathname + url.search,
      url: url.toString(),
      querystring: Object.fromEntries(url.searchParams),
      headers: headersOf(c.req.raw.headers, redact),
      size: size(c.req.raw.headers),
    },
    upstream_uri: redactPath(route?.upstreamPath, redact),
    response: {
      status: c.res.status,
      headers: headersOf(c.res.headers, redact),
      size: size(c.res.headers),
    },
    latencies: {
      request: now - startedAt,
      kong: now - startedAt,
      proxy: HTTP_LOG.unknownLatency,
    },
    client_ip: c.req.header(HEADER.clientIp),
    started_at: startedAt,
    route: route?.route,
    service: route?.service,
    consumer,
    authenticated_entity:
      consumer && credential
        ? { id: credential, consumer_id: consumer.id }
        : undefined,
  };
}

/** Credentials in the endpoint URL become a Basic Authorization header, as in Kong. */
function endpointOf(raw: string): { url: string; authorization?: string } {
  const url = new URL(raw);
  if (!url.username && !url.password) return { url: raw };
  const credentials = `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`;
  url.username = "";
  url.password = "";
  return {
    url: url.toString(),
    authorization: AUTHORIZATION.basic(btoa(credentials)),
  };
}

export default definePlugin({
  name: "http-log",
  version: "1.0.0",
  priority: 12,
  config: kongSchema("http-log"),
  access: () => async (c, next) => {
    c.set("edgwayHttpLogStartedAt", Date.now());
    await next();
  },
  log: (config) => async (c) => {
    if (!config.http_endpoint) return;
    const { url, authorization } = endpointOf(config.http_endpoint);
    const headers: Record<string, string> = {
      ...(config.headers ?? {}),
      [HEADER.contentType]: config.content_type ?? MEDIA_TYPE.json,
    };
    if (authorization) headers[HEADER.authorization] = authorization;
    const delivery: HttpLogDelivery = {
      endpoint: url,
      method: config.method,
      headers,
      body: JSON.stringify(entry(c)),
    };
    const transport = c.get("edgwayHttpLogTransport");
    try {
      if (transport && (await transport.deliver(delivery, config.timeout))) {
        return;
      }
    } catch {
      // Unreachable or timed out: retried below when a queue is bound.
    }
    await c.get("edgwayHttpLogQueue")?.send(delivery);
  },
});
