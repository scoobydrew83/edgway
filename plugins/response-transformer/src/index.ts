/**
 * Kong's response-transformer (priority 800): remove, rename, replace, add and
 * append on response headers (`header_filter`) and on a JSON body's top-level
 * keys (`body_filter`), with `json_types` casting values to booleans, numbers
 * or strings (register `small-kong-plugins`). JSON bodies are rewritten through
 * the SDK's bounded buffer; larger bodies, non-JSON bodies and
 * invalid JSON stream through untouched.
 */
import { HEADER, MEDIA_TYPE, TRANSFORMER } from "@edgway/constants";
import {
  boundedBodyTransform,
  definePlugin,
  type PluginConfig,
} from "@edgway/plugin-sdk";
import { kongSchema } from "@edgway/schema";
import type { Context } from "hono";

const schema = kongSchema("response-transformer");
type Config = PluginConfig<typeof schema>;
type Operation = "remove" | "rename" | "replace" | "add" | "append";

function pair(entry: string): [string, string] {
  const i = entry.indexOf(TRANSFORMER.pairSeparator);
  return i < 0 ? [entry, ""] : [entry.slice(0, i), entry.slice(i + 1)];
}

/** Kong's cast_value: `json_types` entries line up with the `json` entries. */
function cast(value: string, type: string | undefined): unknown {
  if (type === "number") {
    // A non-numeric value stays a string rather than becoming NaN (null in JSON).
    const n = Number(value);
    return Number.isNaN(n) ? value : n;
  }
  if (type === "boolean") return value === String(true);
  return value;
}

const isJson = (c: Context) => {
  const type = c.res.headers
    .get(HEADER.contentType)
    ?.split(";")[0]
    ?.trim()
    .toLowerCase();
  return type === MEDIA_TYPE.json || Boolean(type?.endsWith("+json"));
};

const hasJsonOps = (config: Config) =>
  (["remove", "rename", "replace", "add", "append"] as Operation[]).some(
    (op) => (config[op]?.json?.length ?? 0) > 0,
  );

function transformHeaders(headers: Headers, config: Config): void {
  for (const name of config.remove?.headers ?? []) headers.delete(name);
  for (const entry of config.rename?.headers ?? []) {
    const [from, to] = pair(entry);
    const value = headers.get(from);
    if (value !== null) {
      headers.delete(from);
      headers.set(to, value);
    }
  }
  for (const entry of config.replace?.headers ?? []) {
    const [name, value] = pair(entry);
    if (headers.has(name)) headers.set(name, value);
  }
  for (const entry of config.add?.headers ?? []) {
    const [name, value] = pair(entry);
    if (!headers.has(name)) headers.set(name, value);
  }
  for (const entry of config.append?.headers ?? []) {
    const [name, value] = pair(entry);
    headers.append(name, value);
  }
}

function transformJson(body: Record<string, unknown>, config: Config): void {
  for (const name of config.remove?.json ?? []) delete body[name];
  for (const entry of config.rename?.json ?? []) {
    const [from, to] = pair(entry);
    if (from in body) {
      body[to] = body[from];
      delete body[from];
    }
  }
  (config.replace?.json ?? []).forEach((entry, i) => {
    const [name, value] = pair(entry);
    if (name in body) body[name] = cast(value, config.replace?.json_types?.[i]);
  });
  (config.add?.json ?? []).forEach((entry, i) => {
    const [name, value] = pair(entry);
    if (!(name in body)) body[name] = cast(value, config.add?.json_types?.[i]);
  });
  (config.append?.json ?? []).forEach((entry, i) => {
    const [name, value] = pair(entry);
    const v = cast(value, config.append?.json_types?.[i]);
    const current = body[name];
    body[name] =
      current === undefined
        ? [v]
        : Array.isArray(current)
          ? [...current, v]
          : [current, v];
  });
}

export default definePlugin({
  name: "response-transformer",
  version: "1.0.0",
  priority: 800,
  config: schema,
  header_filter: (config) => (c) => {
    transformHeaders(c.res.headers, config);
    // The body may change length.
    if (hasJsonOps(config) && isJson(c))
      c.res.headers.delete(HEADER.contentLength);
  },
  body_filter: (config) => (c) => {
    if (!hasJsonOps(config) || !isJson(c)) return undefined;
    return boundedBodyTransform(TRANSFORMER.maxBodyBytes, (text) => {
      const parsed = JSON.parse(text);
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        return text;
      }
      transformJson(parsed, config);
      return JSON.stringify(parsed);
    });
  },
});
