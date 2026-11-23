/// <reference path="./consistent-hash.d.ts" />
/**
 * Kong upstream balancing: weighted round-robin (custom; the only npm option
 * is unlicensed), consistent hashing (`consistent-hash`), and passive health
 * checks as one cockatiel circuit breaker per target.
 */

import { BALANCER, HEADER } from "@edgway/constants";
import { getConsumer } from "@edgway/core";
import type { CircuitBreakerPolicy } from "cockatiel";
import ConsistentHash from "consistent-hash";
import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import { loadCockatiel } from "../cockatiel.js";

/** The Kong upstream fields the balancer reads. */
export interface KongUpstream {
  name: string;
  algorithm?: string;
  hash_on?: string;
  hash_fallback?: string;
  hash_on_header?: string | null;
  hash_fallback_header?: string | null;
  hash_on_cookie?: string | null;
  hash_on_query_arg?: string | null;
  hash_fallback_query_arg?: string | null;
  healthchecks?: {
    passive?: {
      unhealthy?: {
        tcp_failures?: number;
        timeouts?: number;
        http_failures?: number;
        http_statuses?: number[];
      };
      healthy?: { successes?: number };
    };
  } | null;
}

export interface KongTarget {
  target: string;
  weight?: number;
}

export interface Balancer {
  /** The targets to try, best first; unhealthy targets are left out. */
  pick(c: Context): string[];
  /** Record the outcome of a call to a target (passive health). */
  report(target: string, outcome: { ok: boolean; status?: number }): void;
}

/** Smooth weighted round-robin (nginx's algorithm): even spread, exact ratios. */
function weightedRoundRobin(targets: { target: string; weight: number }[]) {
  const current = new Map(targets.map((t) => [t.target, 0]));
  const total = targets.reduce((sum, t) => sum + t.weight, 0);
  return (): string[] => {
    let best = targets[0];
    for (const t of targets) {
      const value = (current.get(t.target) ?? 0) + t.weight;
      current.set(t.target, value);
      if (best && value > (current.get(best.target) ?? 0)) best = t;
    }
    if (!best) return [];
    current.set(best.target, (current.get(best.target) ?? 0) - total);
    return [
      best.target,
      ...targets.map((t) => t.target).filter((t) => t !== best.target),
    ];
  };
}

function hashKey(
  c: Context,
  on: string | undefined,
  upstream: KongUpstream,
  fallback: boolean,
) {
  const header = fallback
    ? upstream.hash_fallback_header
    : upstream.hash_on_header;
  const arg = fallback
    ? upstream.hash_fallback_query_arg
    : upstream.hash_on_query_arg;
  switch (on) {
    case "consumer":
      return getConsumer(c)?.id;
    case "ip":
      return c.req.header(HEADER.clientIp);
    case "header":
      return header ? c.req.header(header) : undefined;
    case "cookie":
      return upstream.hash_on_cookie
        ? getCookie(c, upstream.hash_on_cookie)
        : undefined;
    case "query_arg":
      return arg ? c.req.query(arg) : undefined;
    case "path":
      return c.req.path;
    default:
      return undefined;
  }
}

/** Marks a failed call so the target's breaker counts it. */
class TargetFailure extends Error {}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/** Async because cockatiel loads on first use (see ../cockatiel). */
export async function createBalancer(
  upstream: KongUpstream,
  targets: readonly KongTarget[],
): Promise<Balancer> {
  const { CircuitState, ConsecutiveBreaker, circuitBreaker, handleAll } =
    await loadCockatiel();
  const live = [...targets]
    .filter((t) => (t.weight ?? BALANCER.targetWeight) > 0)
    .map((t) => ({
      target: t.target,
      weight: t.weight ?? BALANCER.targetWeight,
    }))
    .sort((a, b) => a.target.localeCompare(b.target));

  const roundRobin = weightedRoundRobin(live);

  // Uniform control points make the ring identical in every isolate.
  const ring = new ConsistentHash({
    range: 1_000_003,
    weight: 10,
    distribution: "uniform",
  });
  const unit = live.reduce((g, t) => gcd(g, t.weight), 0) || 1;
  for (const t of live) {
    for (let i = 0; i < Math.min(t.weight / unit, 100); i++) ring.add(t.target);
  }

  const unhealthy = upstream.healthchecks?.passive?.unhealthy;
  const threshold = Math.max(
    unhealthy?.tcp_failures ?? 0,
    unhealthy?.timeouts ?? 0,
    unhealthy?.http_failures ?? 0,
  );
  // Kong's passive checks are off unless a threshold is configured.
  const breakers = new Map<string, CircuitBreakerPolicy>();
  if (threshold > 0) {
    for (const t of live) {
      breakers.set(
        t.target,
        circuitBreaker(handleAll, {
          halfOpenAfter: BALANCER.unhealthyRetryMs,
          breaker: new ConsecutiveBreaker(threshold),
        }),
      );
    }
  }
  const healthy = (target: string) =>
    breakers.get(target)?.state !== CircuitState.Open;

  return {
    pick(c) {
      let order: string[] | undefined;
      if (upstream.algorithm === "consistent-hashing") {
        const key =
          hashKey(c, upstream.hash_on, upstream, false) ??
          hashKey(c, upstream.hash_fallback, upstream, true);
        if (key !== undefined) order = ring.get(key, live.length);
      }
      return (order ?? roundRobin()).filter(healthy);
    },
    report(target, { ok, status }) {
      const breaker = breakers.get(target);
      if (!breaker) return;
      const failed =
        !ok ||
        (status !== undefined &&
          (unhealthy?.http_failures ?? 0) > 0 &&
          (unhealthy?.http_statuses ?? []).includes(status));
      breaker
        .execute(() => {
          if (failed) throw new TargetFailure();
        })
        .catch(() => {});
    },
  };
}
