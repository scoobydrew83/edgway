/**
 * The Upstream adapter: public URL, Service Binding, or Workers VPC with a
 * public-Tunnel + Access service-token fallback. Requests go through
 * `hono/proxy`, which streams bodies and drops hop-by-hop headers.
 */
import { HEADER, SERVICE_URL_PORT, UPSTREAM } from "@edgway/constants";
import type { Upstream, UpstreamTarget } from "@edgway/core";
import { getRoute } from "@edgway/core";
import { ERR, fail } from "@edgway/errors";
import type { Context } from "hono";
import { proxy } from "hono/proxy";
import type { Balancer } from "../balancer/index.js";
import { loadCockatiel } from "../cockatiel.js";

/** A Workers VPC service, and the public Tunnel hostname to use without it. */
export interface VpcService {
  binding?: Fetcher;
  tunnel?: { origin: string; clientId: string; clientSecret: string };
}

export interface UpstreamOptions {
  /** Service Bindings, by binding name (`kind: "binding"`). */
  bindings?: Record<string, Fetcher | undefined>;
  /** Workers VPC services, by name (`kind: "vpc"`). */
  vpc?: Record<string, VpcService | undefined>;
  /** Kong upstreams, by name: a URL target whose host is one is balanced. */
  balancers?: Record<string, Balancer | undefined>;
}

/**
 * The upstream URL: the target's origin with the matched path and query.
 * Assigned field by field, so a path starting `//` can never change the host.
 */
function upstreamUrl(origin: string, path: string): URL {
  const url = new URL(origin);
  const query = path.indexOf("?");
  url.pathname = query < 0 ? path : path.slice(0, query);
  url.search = query < 0 ? "" : path.slice(query);
  return url;
}

interface Send {
  url: URL;
  /** The Kong target (`host:port`) when balanced; the URL drops default ports. */
  target?: string;
  fetcher?: Fetcher;
  headers?: Record<string, string>;
}

export function createUpstream(options: UpstreamOptions = {}): Upstream {
  async function send(c: Context, target: UpstreamTarget, attempt: Send) {
    const headers = new Headers(c.req.raw.headers);
    // preserve_host: Kong's client Host. The Workers runtime (workerd, as
    // tested) takes a subrequest's Host from its URL regardless, so the
    // upstream gets the client's host in X-Forwarded-Host.
    const upstreamHost = getRoute(c)?.upstreamHost;
    if (upstreamHost) headers.set(HEADER.host, upstreamHost);
    else headers.delete(HEADER.host);
    // Kong appends the client's address to X-Forwarded-For.
    const client = c.req.header(HEADER.clientIp);
    if (client) {
      const forwarded = headers.get(HEADER.forwardedFor);
      headers.set(
        HEADER.forwardedFor,
        forwarded ? `${forwarded}, ${client}` : client,
      );
      headers.set(HEADER.realIp, client);
    } else headers.delete(HEADER.realIp);
    // ...and sets the rest from the request it received, replacing any the
    // client sent (Kong trusts no proxy by default).
    const received = new URL(c.req.url);
    const scheme = received.protocol.slice(0, -1);
    headers.set(HEADER.forwardedProto, scheme);
    headers.set(HEADER.forwardedHost, received.hostname);
    headers.set(
      HEADER.forwardedPort,
      received.port || String(SERVICE_URL_PORT[scheme] ?? ""),
    );
    for (const [name, value] of Object.entries(attempt.headers ?? {})) {
      headers.set(name, value);
    }
    const limit =
      (target.connectTimeoutMs ?? UPSTREAM.connectTimeoutMs) +
      (target.readTimeoutMs ?? UPSTREAM.readTimeoutMs);
    const { TimeoutStrategy, timeout } = await loadCockatiel();
    // Until the response headers arrive; the body then streams unbounded, so
    // the signal must not be aborted once the policy returns.
    return timeout(limit, {
      strategy: TimeoutStrategy.Aggressive,
      abortOnReturn: false,
    }).execute(({ signal }) =>
      proxy(attempt.url, {
        // A copy with our headers; hono/proxy still drops hop-by-hop ones.
        raw: new Request(c.req.raw, { headers }),
        signal,
        // A 3xx goes back to the client, as in Kong: following it would
        // replay the client's request, credentials included, to wherever
        // the Location names.
        redirect: "manual",
        customFetch: attempt.fetcher
          ? (request: Request) => (attempt.fetcher as Fetcher).fetch(request)
          : undefined,
      }),
    );
  }

  /**
   * Try targets in turn. A request with a body is sent once: a streamed body
   * can't be replayed. Connection errors and timeouts move to the next try;
   * any HTTP response is final (Kong's default retry behaviour).
   */
  async function attempts(
    c: Context,
    target: UpstreamTarget,
    tries: Send[],
    report?: (send: Send, outcome: { ok: boolean; status?: number }) => void,
  ): Promise<Response> {
    const max = c.req.raw.body
      ? 1
      : Math.max(1, (target.retries ?? UPSTREAM.retries) + 1);
    for (let i = 0; i < Math.min(max, tries.length); i++) {
      const attempt = tries[i] as Send;
      try {
        const response = await send(c, target, attempt);
        report?.(attempt, { ok: true, status: response.status });
        return response;
      } catch {
        report?.(attempt, { ok: false });
      }
    }
    fail(ERR.UPSTREAM_UNREACHABLE);
  }

  const repeat = (send: Send, target: UpstreamTarget): Send[] =>
    Array.from(
      { length: (target.retries ?? UPSTREAM.retries) + 1 },
      () => send,
    );

  return {
    async forward(c, target) {
      switch (target.kind) {
        case "binding": {
          const fetcher = options.bindings?.[target.target];
          if (!fetcher) fail(ERR.UPSTREAM_BINDING_MISSING);
          const url = upstreamUrl(`https://${target.target}`, target.path);
          return attempts(c, target, repeat({ url, fetcher }, target));
        }

        case "vpc": {
          const service = options.vpc?.[target.target];
          const tries: Send[] = [];
          if (service?.binding) {
            tries.push({
              url: upstreamUrl(`https://${target.target}`, target.path),
              fetcher: service.binding,
            });
          }
          if (service?.tunnel) {
            const { origin, clientId, clientSecret } = service.tunnel;
            tries.push({
              url: upstreamUrl(origin, target.path),
              headers: {
                [HEADER.cfAccessClientId]: clientId,
                [HEADER.cfAccessClientSecret]: clientSecret,
              },
            });
          }
          if (tries.length === 0) fail(ERR.UPSTREAM_BINDING_MISSING);
          // VPC first; the Tunnel only if VPC fails to connect.
          return attempts(c, { ...target, retries: tries.length - 1 }, tries);
        }

        default: {
          const base = new URL(target.target);
          const balancer = options.balancers?.[base.hostname];
          if (!balancer) {
            return attempts(
              c,
              target,
              repeat({ url: upstreamUrl(target.target, target.path) }, target),
            );
          }
          const picked = balancer.pick(c);
          if (picked.length === 0) fail(ERR.UPSTREAM_UNREACHABLE);
          // Retries move round the healthy targets, as Kong's balancer does.
          const total = (target.retries ?? UPSTREAM.retries) + 1;
          const tries = Array.from({ length: total }, (_, i) => {
            const url = upstreamUrl(target.target, target.path);
            const chosen = picked[i % picked.length] as string;
            url.host = chosen;
            return { url, target: chosen };
          });
          return attempts(c, target, tries, (send, outcome) => {
            if (send.target) balancer.report(send.target, outcome);
          });
        }
      }
    },
  };
}
