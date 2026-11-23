/**
 * Derived from Kong/kong 3.9.0 (kong/router/transform.lua), Apache-2.0,
 * Copyright Kong Inc.; ported to TypeScript and modified (third-party/kong).
 *
 * Kong 3.9's route priority (kong/router/transform.lua `get_priority`, the
 * traditional_compatible router), bit for bit:
 *
 *   match weight (3 bits) | plain hosts only | header count (8) | regex path
 *   | regex_priority (32) | longest prefix length (19)
 */
import type { KongRoute } from "./types.js";

const PLAIN_HOST_ONLY_BIT = 1n << 60n;
const REGEX_URL_BIT = 1n << 51n;
const MAX_HEADER_COUNT = 255;

const u64 = (value: bigint) => BigInt.asUintN(64, value);
const present = (
  value: unknown[] | Record<string, unknown> | null | undefined,
) => value != null && Object.keys(value).length > 0;

export const isRegexPath = (path: string) => path.startsWith("~");

/** Priority of a route restricted to one group of paths (see groupPaths). */
export function routePriority(route: KongRoute, paths?: string[]): bigint {
  let weight = 0;
  if (present(route.sources)) weight++;
  if (present(route.destinations)) weight++;
  if (present(route.methods)) weight++;
  if (present(route.hosts)) weight++;
  const headerCount = Math.min(
    route.headers ? Object.keys(route.headers).length : 0,
    MAX_HEADER_COUNT,
  );
  if (headerCount > 0) weight++;
  if (present(route.snis)) weight++;

  const plainHostOnly =
    Array.isArray(route.hosts) && !route.hosts.some((h) => h.includes("*"));

  let uriLength = 0;
  let regex = false;
  if (paths && paths.length > 0) {
    weight++;
    regex = isRegexPath(paths[0] as string);
    if (!regex) uriLength = (paths[0] as string).length;
  }

  return (
    (BigInt(weight) << 61n) |
    (plainHostOnly ? PLAIN_HOST_ONLY_BIT : 0n) |
    (regex ? REGEX_URL_BIT : 0n) |
    (BigInt(headerCount) << 52n) |
    u64(BigInt(regex ? (route.regex_priority ?? 0) : 0) << 19n) |
    BigInt(uriLength & 0x7ffff)
  );
}

/**
 * Kong splits a route with several paths into one entry per group: all regex
 * paths together, and prefix paths grouped by length (split_routes_and_services_by_path).
 */
export function groupPaths(paths: string[]): string[][] {
  const groups = new Map<string | number, string[]>();
  for (const path of paths) {
    const key = isRegexPath(path) ? "regex" : path.length;
    groups.set(key, [...(groups.get(key) ?? []), path]);
  }
  return [...groups.values()];
}
