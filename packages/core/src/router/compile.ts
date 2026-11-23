/**
 * Compiles Kong routes into a matcher with Kong 3.9's semantics
 * (traditional_compatible router): the same match fields, the same priority,
 * and the same upstream path rules.
 */

import { HEADER } from "@edgway/constants";
import { escapePath, normalizePath, upstreamUri } from "./paths.js";
import { groupPaths, isRegexPath, routePriority } from "./priority.js";
import type { KongRoute, KongService, RouteMatch } from "./types.js";

/** A header rule, compiled once: exact values (lower-case) and `~*` regexes. */
interface HeaderRule {
  name: string;
  values: string[];
  patterns: RegExp[];
}

interface Entry {
  route: KongRoute;
  service?: KongService;
  priority: bigint;
  prefixes: string[];
  regexes: RegExp[];
  hasPaths: boolean;
  headers: HeaderRule[];
}

export interface SkippedRoute {
  route: string;
  unsupported: "expression" | "snis" | "sources" | "destinations" | "regex";
}

export interface CompiledRouter {
  match(request: Request): RouteMatch | undefined;
  /** Routes left out, with the Kong field Edgway can't match on. */
  skipped: SkippedRoute[];
}

const DEFAULT_PORT: Record<string, string> = { "http:": "80", "https:": "443" };

function splitHostPort(value: string): [string, string | undefined] {
  const at = value.lastIndexOf(":");
  if (at > 0 && !value.endsWith("]") && /^\d+$/.test(value.slice(at + 1))) {
    return [value.slice(0, at), value.slice(at + 1)];
  }
  return [value, undefined];
}

/** Kong host rules: exact, `*.suffix` or `prefix.*`, with an optional port. */
function hostMatches(pattern: string, host: string, port: string): boolean {
  const [wanted, wantedPort] = splitHostPort(pattern.toLowerCase());
  if (wantedPort !== undefined && wantedPort !== port) return false;
  if (wanted.startsWith("*")) return host.endsWith(wanted.slice(1));
  if (wanted.endsWith("*")) return host.startsWith(wanted.slice(0, -1));
  return host === wanted;
}

/**
 * Kong header rules: every configured header must match one of its values,
 * compared lower-case; a value starting `~*` is a regex (Kong lower-cases its
 * source too). Headers.get joins repeated headers with commas, so each
 * comma-separated part is also tried; Kong tests each header line instead.
 */
function compileHeaders(headers: Record<string, string[]>): HeaderRule[] {
  return Object.entries(headers).map(([name, values]) => {
    const lower = values.map((v) => v.toLowerCase());
    return {
      name,
      values: lower.filter((v) => !v.startsWith("~*")),
      patterns: lower
        .filter((v) => v.startsWith("~*"))
        .map((v) => new RegExp(v.slice(2))),
    };
  });
}

function headersMatch(rules: HeaderRule[], headers: Headers): boolean {
  return rules.every((rule) => {
    const raw = headers.get(rule.name);
    if (raw === null) return false;
    const actual = [raw, ...raw.split(",")].map((v) => v.trim().toLowerCase());
    return actual.some(
      (v) => rule.values.includes(v) || rule.patterns.some((re) => re.test(v)),
    );
  });
}

function unsupportedField(
  route: KongRoute,
): SkippedRoute["unsupported"] | undefined {
  if (route.expression) return "expression";
  for (const field of ["snis", "sources", "destinations"] as const) {
    const value = route[field];
    if (value && value.length > 0) return field;
  }
  return undefined;
}

export function compileRouter(
  routes: readonly KongRoute[],
  services: readonly KongService[] = [],
): CompiledRouter {
  const serviceById = new Map(services.map((s) => [s.id, s]));
  const skipped: CompiledRouter["skipped"] = [];
  const entries: Entry[] = [];

  for (const route of routes) {
    const field = unsupportedField(route);
    if (field) {
      skipped.push({ route: route.id, unsupported: field });
      continue;
    }
    const service = route.service_id
      ? serviceById.get(route.service_id)
      : undefined;
    const groups = route.paths?.length ? groupPaths(route.paths) : [undefined];
    let compiled: Entry[];
    try {
      // Kong compiles regexes with Rust's regex crate; some of its syntax
      // (e.g. inline flags) isn't valid in JS. Skip that route, not the config.
      const headers = compileHeaders(route.headers ?? {});
      compiled = groups.map((paths) => ({
        route,
        service,
        priority: routePriority(route, paths),
        prefixes: (paths ?? [])
          .filter((p) => !isRegexPath(p))
          .map(normalizePath),
        // Kong anchors regex paths at the start (`^`), not the end.
        regexes: (paths ?? [])
          .filter(isRegexPath)
          .map((p) => new RegExp(`^${p.slice(1)}`)),
        hasPaths: paths !== undefined,
        headers,
      }));
    } catch {
      skipped.push({ route: route.id, unsupported: "regex" });
      continue;
    }
    entries.push(...compiled);
  }

  // Highest priority first; ties by id, highest first (atc-router orders by
  // UUID bytes, which lower-case hex strings compare the same as).
  const desc = <T>(a: T, b: T) => (a === b ? 0 : a > b ? -1 : 1);
  entries.sort(
    (a, b) => desc(a.priority, b.priority) || desc(a.route.id, b.route.id),
  );

  return {
    skipped,
    match(request) {
      const url = new URL(request.url);
      const path = normalizePath(url.pathname);
      const hostHeader = request.headers.get(HEADER.host) ?? url.host;
      const [host, explicitPort] = splitHostPort(hostHeader.toLowerCase());
      const port = explicitPort ?? DEFAULT_PORT[url.protocol] ?? "";

      for (const entry of entries) {
        const { route } = entry;
        if (route.methods?.length && !route.methods.includes(request.method))
          continue;
        if (
          route.hosts?.length &&
          !route.hosts.some((h) => hostMatches(h, host, port))
        )
          continue;
        if (
          entry.headers.length > 0 &&
          !headersMatch(entry.headers, request.headers)
        )
          continue;

        let matched: string | undefined;
        let captures: RouteMatch["captures"];
        if (entry.hasPaths) {
          matched = entry.prefixes.find((p) => path.startsWith(p));
          if (matched === undefined) {
            for (const re of entry.regexes) {
              const m = re.exec(path);
              if (m) {
                matched = m[0];
                if (m.length > 1 || m.groups) {
                  captures = {
                    groups: m.slice(1).map((g) => g ?? ""),
                    named: { ...m.groups },
                  };
                }
                break;
              }
            }
          }
          if (matched === undefined) continue;
        }

        const strip = route.strip_path ?? true;
        const upstreamPath = upstreamUri(
          path,
          entry.service?.path ?? "/",
          strip,
          strip ? matched : undefined,
          route.path_handling,
        );
        return {
          route,
          service: entry.service,
          upstreamPath: escapePath(upstreamPath) + url.search,
          upstreamHost: route.preserve_host ? hostHeader : undefined,
          captures,
        };
      }
      return undefined;
    },
  };
}
