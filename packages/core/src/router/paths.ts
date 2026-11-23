/**
 * Derived from Kong/kong 3.9.0 (kong/router/utils.lua, kong/tools/uri.lua),
 * Apache-2.0, Copyright Kong Inc.; ported to TypeScript and modified
 * (third-party/kong).
 *
 * Kong's request-path normalization and upstream URI rules.
 */

/**
 * Kong's `kong.tools.uri` (3.9.0): `normalize(uri, merge_slashes = true)` for
 * the path the router matches, and `escape` for the path sent upstream.
 */

const RESERVED = new Set(
  [..."!*'();:@&=+$,/?%#[]"].map((c) => c.charCodeAt(0)),
);

/**
 * Decode every percent-encoded triplet except reserved characters (whose hex
 * is upper-cased), remove dot segments and merge repeated slashes.
 */
export function normalizePath(input: string): string {
  let uri = input;
  if (uri === "" || uri === "/") return uri;

  if (uri.includes("%")) {
    uri = uri.replace(/%([0-9a-f]{2})/gi, (triplet, hex: string) => {
      const code = Number.parseInt(hex, 16);
      return RESERVED.has(code)
        ? triplet.toUpperCase()
        : String.fromCharCode(code);
    });
  }

  if (!uri.includes(".") && !uri.includes("//")) return uri;

  const output: string[] = [];
  while (uri.length > 0) {
    if (uri === "/.") uri = "/";
    else if (uri === "/..") {
      uri = "/";
      output.pop();
    } else if (uri === "." || uri === "..") uri = "";
    else if (uri.startsWith("../")) uri = uri.slice(3);
    else if (uri.startsWith("./")) uri = uri.slice(2);
    else if (uri.startsWith("/./")) uri = uri.slice(2);
    else if (uri.startsWith("/../")) {
      uri = uri.slice(3);
      output.pop();
    } else if (uri.startsWith("//")) uri = uri.slice(1);
    else {
      const next = uri.indexOf("/", 1);
      if (next > 0) {
        output.push(uri.slice(0, next));
        uri = uri.slice(next);
      } else {
        output.push(uri);
        uri = "";
      }
    }
  }
  return output.join("");
}

const encoder = new TextEncoder();

/** Percent-encode what isn't safe in an HTTP path, keeping reserved characters. */
export function escapePath(uri: string): string {
  return uri.replace(/[^!#$&'()*+,/:;=?@[\]A-Za-z0-9\-_.~%]/g, (char) => {
    const code = char.charCodeAt(0);
    const bytes = code < 0x100 ? [code] : [...encoder.encode(char)];
    return bytes
      .map((b) => `%${b.toString(16).toUpperCase().padStart(2, "0")}`)
      .join("");
  });
}

function sanitizePostfix(postfix: string): string {
  if (postfix === "" || postfix === "." || postfix === "..") return "";
  if (postfix.startsWith("./")) return postfix.slice(2);
  if (postfix.startsWith("../")) return postfix.slice(3);
  return postfix;
}

/**
 * Kong's `get_upstream_uri_v0`, or `get_upstream_uri_v1` for a route with
 * `path_handling: "v1"`. `prefix` is the matched path when
 * strip_path is on (for a regex, the matched text), otherwise undefined.
 */
export function upstreamUri(
  requestPath: string,
  servicePath: string,
  stripPath: boolean,
  prefix: string | undefined,
  pathHandling?: string | null,
): string {
  const postfix = sanitizePostfix(requestPath.slice((prefix ?? "/").length));
  const base = servicePath;

  if (pathHandling === "v1") {
    // v1 joins the service path and the (stripped) request path as they
    // are: no slash is added, a doubled one is dropped.
    if (!stripPath) return base + requestPath.slice(1);
    if (base.endsWith("/") && postfix.startsWith("/")) {
      return base.slice(0, -1) + postfix;
    }
    return base + postfix;
  }

  if (base.endsWith("/")) {
    if (stripPath) {
      if (postfix === "") {
        if (base === "/") return "/";
        if (requestPath.endsWith("/")) return base;
        return base.slice(0, -1);
      }
      if (postfix.startsWith("/")) return base.slice(0, -1) + postfix;
      return base + postfix;
    }
    return base + requestPath.slice(1);
  }

  if (stripPath) {
    if (postfix === "") {
      return requestPath.length > 1 && requestPath.endsWith("/")
        ? `${base}/`
        : base;
    }
    if (postfix.startsWith("/")) return base + postfix;
    return `${base}/${postfix}`;
  }

  if (requestPath === "/") return base;
  return base + requestPath;
}
