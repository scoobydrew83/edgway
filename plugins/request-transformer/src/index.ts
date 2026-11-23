/**
 * Kong's request-transformer (priority 801): remove, rename, replace, add and
 * append on headers, the querystring and JSON or form-urlencoded bodies, plus
 * `replace.uri` and `http_method` (register `small-kong-plugins`: small,
 * simple operations no library matches). Values may use Kong's simple
 * templates: `$(headers.name)`, `$(query_params.name)`, `$(uri_captures.name)`
 * and the `[...]` forms. Bodies are rewritten through the SDK's bounded buffer
 *; larger or other bodies stream through untouched.
 */
import { HEADER, MEDIA_TYPE, TRANSFORMER } from "@edgway/constants";
import { getRoute } from "@edgway/core";
import { ERR, fail } from "@edgway/errors";
import { definePlugin, type PluginConfig } from "@edgway/plugin-sdk";
import { kongSchema } from "@edgway/schema";
import type { Context, Next } from "hono";
import { bodyLimit } from "hono/body-limit";

const schema = kongSchema("request-transformer");
type Config = PluginConfig<typeof schema>;
type Lists = {
  body?: string[] | null;
  headers?: string[] | null;
  querystring?: string[] | null;
};

/** Kong's `name:value` entry (the value may itself contain `:`). */
function pair(entry: string): [string, string] {
  const i = entry.indexOf(TRANSFORMER.pairSeparator);
  return i < 0 ? [entry, ""] : [entry.slice(0, i), entry.slice(i + 1)];
}

const TEMPLATE =
  /\$\((headers|query_params|uri_captures)(?:\.([\w-]+)|\[\s*['"]?([^'"\]]+?)['"]?\s*\])\)/g;

/** Render Kong's simple templates against the incoming request. */
function renderer(c: Context) {
  const captures = getRoute(c)?.captures;
  return (value: string) =>
    value.replace(TEMPLATE, (_match, source, dotted, bracketed) => {
      const name = String(dotted ?? bracketed);
      if (source === "headers") return c.req.header(name) ?? "";
      if (source === "query_params") return c.req.query(name) ?? "";
      const index = Number(name);
      return (
        (Number.isInteger(index)
          ? captures?.groups[index - 1]
          : captures?.named[name]) ?? ""
      );
    });
}

/** Headers, query, form or JSON fields: what Kong's operations act on. */
interface Fields {
  has(name: string): boolean;
  delete(name: string): void;
  /** Move a field, all its values, to a new name. */
  rename(from: string, to: string): void;
  /** Set a single value (replace, add). */
  set(name: string, value: string): void;
  /** Add another value (append). */
  append(name: string, value: string): void;
}

/** Kong's order: remove, rename, replace, add, append. */
function apply(
  fields: Fields,
  config: Config,
  kind: keyof Lists,
  render: (v: string) => string,
): void {
  for (const name of config.remove?.[kind] ?? []) fields.delete(name);
  for (const entry of config.rename?.[kind] ?? []) {
    const [from, to] = pair(entry);
    if (fields.has(from)) fields.rename(from, to);
  }
  for (const entry of config.replace?.[kind] ?? []) {
    const [name, value] = pair(entry);
    if (fields.has(name)) fields.set(name, render(value));
  }
  for (const entry of config.add?.[kind] ?? []) {
    const [name, value] = pair(entry);
    if (!fields.has(name)) fields.set(name, render(value));
  }
  for (const entry of config.append?.[kind] ?? []) {
    const [name, value] = pair(entry);
    fields.append(name, render(value));
  }
}

/**
 * A header write with a value rendered from the request (a template): one
 * that isn't a valid header is the client's doing, so it's refused with a
 * 400, never thrown as a plugin failure that counts toward its breaker
 *.
 */
function writeHeader(write: () => void): void {
  try {
    write();
  } catch (error) {
    if (error instanceof TypeError) fail(ERR.REQUEST_HEADER_INVALID);
    throw error;
  }
}

const headerFields = (headers: Headers): Fields => ({
  has: (n) => headers.has(n),
  delete: (n) => headers.delete(n),
  rename: (from, to) => {
    const value = headers.get(from) ?? "";
    headers.delete(from);
    writeHeader(() => headers.set(to, value));
  },
  set: (n, v) => writeHeader(() => headers.set(n, v)),
  append: (n, v) => writeHeader(() => headers.append(n, v)),
});

const paramFields = (params: URLSearchParams): Fields => ({
  has: (n) => params.has(n),
  delete: (n) => params.delete(n),
  rename: (from, to) => {
    const values = params.getAll(from);
    params.delete(from);
    params.delete(to);
    for (const v of values) params.append(to, v);
  },
  set: (n, v) => params.set(n, v),
  append: (n, v) => params.append(n, v),
});

/** Top-level JSON keys; append makes an array, as Kong's append_value does. */
const jsonFields = (body: Record<string, unknown>): Fields => ({
  has: (n) => n in body,
  delete: (n) => {
    delete body[n];
  },
  rename: (from, to) => {
    body[to] = body[from];
    delete body[from];
  },
  set: (n, v) => {
    body[n] = v;
  },
  append: (n, v) => {
    const current = body[n];
    body[n] =
      current === undefined
        ? [v]
        : Array.isArray(current)
          ? [...current, v]
          : [current, v];
  },
});

const hasBodyOps = (config: Config) =>
  [
    config.remove,
    config.rename,
    config.replace,
    config.add,
    config.append,
  ].some((op) => (op?.body?.length ?? 0) > 0);

const BODILESS = new Set(["GET", "HEAD", "TRACE"]);

/** hono/body-limit: a body over the bound is refused. */
const bounded = bodyLimit({
  maxSize: TRANSFORMER.maxBodyBytes,
  onError: () => fail(ERR.REQUEST_BODY_UNTRANSFORMABLE),
});

const textStream = (text: string) =>
  new Blob([text]).stream() as ReadableStream<Uint8Array>;

export default definePlugin({
  name: "request-transformer",
  version: "1.0.0",
  priority: 801,
  config: schema,
  access: (config) => async (c: Context, next: Next) => {
    const render = renderer(c);
    const original = c.req.raw;
    const url = new URL(c.req.url);
    const headers = new Headers(original.headers);
    const method = config.http_method?.toUpperCase() ?? original.method;
    const type = headers
      .get(HEADER.contentType)
      ?.split(";")[0]
      ?.trim()
      .toLowerCase();
    let body: ReadableStream<Uint8Array> | null = original.body;

    // http_method: to GET/HEAD/TRACE, a small form body moves into the query.
    if (BODILESS.has(method) && body) {
      const length = Number(headers.get(HEADER.contentLength) ?? Number.NaN);
      if (
        type === MEDIA_TYPE.formUrlencoded &&
        length <= TRANSFORMER.maxBodyBytes
      ) {
        for (const [k, v] of new URLSearchParams(await original.text())) {
          url.searchParams.append(k, v);
        }
      } else {
        await body.cancel();
      }
      body = null;
      headers.delete(HEADER.contentLength);
      headers.delete(HEADER.contentType);
    }

    // A body the route changes is edited, or refused: never passed on as
    // it came, which would skip e.g. a `remove.body` of a secret field
    //. It is read whole, up to TRANSFORMER.maxBodyBytes.
    if (body && hasBodyOps(config)) {
      let text = "";
      await bounded(c, async () => {
        // The raw request: c.req.text() would cache the body as it came.
        text = await c.req.raw.text();
      });
      if (text === "" && type === undefined) {
        // No body to speak of: nothing to edit or leak.
        body = textStream(text);
      } else if (type === MEDIA_TYPE.json) {
        let parsed: unknown;
        try {
          parsed = text.trim() === "" ? {} : JSON.parse(text);
        } catch {
          fail(ERR.REQUEST_BODY_UNTRANSFORMABLE);
        }
        if (
          typeof parsed !== "object" ||
          parsed === null ||
          Array.isArray(parsed)
        ) {
          fail(ERR.REQUEST_BODY_UNTRANSFORMABLE);
        }
        apply(
          jsonFields(parsed as Record<string, unknown>),
          config,
          "body",
          render,
        );
        body = textStream(JSON.stringify(parsed));
      } else if (type === MEDIA_TYPE.formUrlencoded) {
        const params = new URLSearchParams(text);
        apply(paramFields(params), config, "body", render);
        body = textStream(params.toString());
      } else {
        fail(ERR.REQUEST_BODY_UNTRANSFORMABLE);
      }
      headers.delete(HEADER.contentLength);
    }

    apply(headerFields(headers), config, "headers", render);
    apply(paramFields(url.searchParams), config, "querystring", render);
    if (config.replace?.uri) url.pathname = render(config.replace.uri);

    c.req.raw = new Request(url, {
      method,
      headers,
      body,
      redirect: original.redirect,
      signal: original.signal,
      duplex: "half",
    } as RequestInit);
    // The gateway forwards to the matched route's upstream path.
    const route = getRoute(c);
    if (route) {
      const [path = ""] = route.upstreamPath.split("?");
      route.upstreamPath =
        (config.replace?.uri ? url.pathname : path) + url.search;
    }
    await next();
  },
});
