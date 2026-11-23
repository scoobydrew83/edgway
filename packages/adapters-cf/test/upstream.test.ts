import { HEADER } from "@edgway/constants";
import type { Upstream, UpstreamTarget } from "@edgway/core";
import { ERR, errorHandler } from "@edgway/errors";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { type Balancer, createBalancer, createUpstream } from "../src/index";

type Echo = {
  url: string;
  method: string;
  host: string | null;
  forwardedFor: string | null;
  forwardedProto: string | null;
  forwardedHost: string | null;
  forwardedPort: string | null;
  realIp: string | null;
  accessId: string | null;
  body: string;
};

function gateway(upstream: Upstream, target: UpstreamTarget) {
  const app = new Hono();
  app.onError(errorHandler());
  app.all("*", (c) => upstream.forward(c, target));
  return app;
}

/** A Service Binding stand-in. */
function fetcher(handler: (request: Request) => Promise<Response>): Fetcher {
  return { fetch: handler } as unknown as Fetcher;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("public URL upstream", () => {
  it("sends the matched path and query to the target origin", async () => {
    const app = gateway(createUpstream(), {
      kind: "url",
      target: "https://httpbin.org",
      path: "/anything/x?y=1",
    });
    const res = await app.fetch(new Request("https://gw.example/demo/x?y=1"));
    const echo = await res.json<Echo>();
    expect(echo.url).toBe("https://httpbin.org/anything/x?y=1");
    expect(echo.host).toBe("httpbin.org");
  });

  it("appends the client's address to X-Forwarded-For", async () => {
    const app = gateway(createUpstream(), {
      kind: "url",
      target: "https://httpbin.org",
      path: "/",
    });
    const first = await (
      await app.fetch(
        new Request("https://gw.example/", {
          headers: { [HEADER.clientIp]: "203.0.113.7" },
        }),
      )
    ).json<Echo>();
    expect(first.forwardedFor).toBe("203.0.113.7");
    const chained = await (
      await app.fetch(
        new Request("https://gw.example/", {
          headers: {
            [HEADER.clientIp]: "203.0.113.7",
            [HEADER.forwardedFor]: "198.51.100.1",
          },
        }),
      )
    ).json<Echo>();
    expect(chained.forwardedFor).toBe("198.51.100.1, 203.0.113.7");
  });

  it("sets Kong's X-Forwarded-Proto, -Host, -Port and X-Real-IP", async () => {
    const app = gateway(createUpstream(), {
      kind: "url",
      target: "https://httpbin.org",
      path: "/",
    });
    const echo = async (url: string, headers: Record<string, string>) =>
      (await app.fetch(new Request(url, { headers }))).json<Echo>();
    // The client's own copies are replaced (Kong trusts no proxy by default).
    const spoofed = {
      [HEADER.forwardedProto]: "gopher",
      [HEADER.forwardedHost]: "evil.example",
      [HEADER.forwardedPort]: "1",
      [HEADER.realIp]: "198.51.100.9",
    };
    expect(
      await echo("https://gw.example/", {
        ...spoofed,
        [HEADER.clientIp]: "203.0.113.7",
      }),
    ).toMatchObject({
      forwardedProto: "https",
      forwardedHost: "gw.example",
      forwardedPort: "443",
      realIp: "203.0.113.7",
    });
    expect(await echo("http://gw.example:8080/", spoofed)).toMatchObject({
      forwardedProto: "http",
      forwardedHost: "gw.example",
      forwardedPort: "8080",
      // Without the client's address, no claimed one passes either.
      realIp: null,
    });
  });

  it("preserve_host: the runtime sends the URL's Host, the client's goes in X-Forwarded-Host", async () => {
    const upstream = createUpstream();
    const target: UpstreamTarget = {
      kind: "url",
      target: "https://httpbin.org",
      path: "/",
    };
    const app = new Hono();
    app.use("*", async (c, next) => {
      // What the router sets for a preserve_host route: the client's Host.
      c.set("edgwayRoute" as never, { upstreamHost: "gw.example" } as never);
      await next();
    });
    app.all("*", (c) => upstream.forward(c, target));
    const echo = await (
      await app.fetch(
        new Request("https://gw.example/", { headers: { host: "gw.example" } }),
      )
    ).json<Echo>();
    // workerd, the Workers runtime, takes a subrequest's Host from its URL
    // even when one is set (documented, not worked around).
    expect(echo.host).toBe("httpbin.org");
    expect(echo.forwardedHost).toBe("gw.example");
  });

  it("passes an upstream's redirect to the client, never following it", async () => {
    const app = gateway(createUpstream(), {
      kind: "url",
      target: "https://redirect.test",
      path: "/",
    });
    const res = await app.fetch(
      new Request("https://gw.example/", {
        headers: { [HEADER.authorization]: "Bearer secret" },
      }),
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://elsewhere.test/stolen");
  });

  it("never lets a path starting // change the host", async () => {
    const app = gateway(createUpstream(), {
      kind: "url",
      target: "https://httpbin.org",
      path: "//evil.example/steal",
    });
    const echo = await (
      await app.fetch(new Request("https://gw.example/x"))
    ).json<Echo>();
    expect(new URL(echo.url).host).toBe("httpbin.org");
  });
});

describe("Service Binding upstream", () => {
  it("forwards through the binding, dropping hop-by-hop headers", async () => {
    let seen: Request | undefined;
    const upstream = createUpstream({
      bindings: {
        API: fetcher(async (req) => {
          seen = req;
          return new Response("ok", {
            headers: { connection: "close", "x-up": "1" },
          });
        }),
      },
    });
    const app = gateway(upstream, {
      kind: "binding",
      target: "API",
      path: "/v1/items?page=2",
    });
    const res = await app.fetch(
      new Request("https://gw.example/items", {
        headers: { connection: "keep-alive", te: "trailers" },
      }),
    );
    expect(await res.text()).toBe("ok");
    expect(
      new URL(seen?.url ?? "").pathname + new URL(seen?.url ?? "").search,
    ).toBe("/v1/items?page=2");
    expect(seen?.headers.get("te")).toBeNull();
    expect(res.headers.get("connection")).toBeNull();
    // The response is mutable, so header_filter plugins can change it.
    res.headers.set("x-filtered", "yes");
    expect(res.headers.get("x-up")).toBe("1");
  });

  it("answers 502 EDG-UP-001 when the binding is missing", async () => {
    const app = gateway(createUpstream(), {
      kind: "binding",
      target: "NOPE",
      path: "/",
    });
    const res = await app.fetch(new Request("https://gw.example/"));
    expect(res.status).toBe(ERR.UPSTREAM_BINDING_MISSING.status);
    expect(await res.json()).toMatchObject({
      code: ERR.UPSTREAM_BINDING_MISSING.code,
    });
  });
});

describe("Workers VPC upstream", () => {
  const tunnel = {
    origin: "https://office.tunnel.example",
    clientId: "id-123",
    clientSecret: "s3cret",
  };

  it("uses the VPC binding when it works", async () => {
    const upstream = createUpstream({
      vpc: {
        office: {
          binding: fetcher(async () => new Response("via vpc")),
          tunnel,
        },
      },
    });
    const res = await gateway(upstream, {
      kind: "vpc",
      target: "office",
      path: "/",
    }).fetch(new Request("https://gw.example/"));
    expect(await res.text()).toBe("via vpc");
  });

  it("falls back to the public Tunnel with the Access service token", async () => {
    const upstream = createUpstream({
      vpc: {
        office: {
          binding: fetcher(async () => {
            throw new Error("VPC unavailable");
          }),
          tunnel,
        },
      },
    });
    const res = await gateway(upstream, {
      kind: "vpc",
      target: "office",
      path: "/status",
    }).fetch(new Request("https://gw.example/"));
    const echo = await res.json<Echo>();
    expect(echo.url).toBe("https://office.tunnel.example/status");
    expect(echo.accessId).toBe("id-123");
  });
});

describe("retries and timeouts", () => {
  it("retries a bodiless request on connection errors", async () => {
    let calls = 0;
    const upstream = createUpstream({
      bindings: {
        API: fetcher(async () => {
          calls++;
          if (calls < 3) throw new Error("connection refused");
          return new Response("third time");
        }),
      },
    });
    const res = await gateway(upstream, {
      kind: "binding",
      target: "API",
      path: "/",
      retries: 2,
    }).fetch(new Request("https://gw.example/"));
    expect(await res.text()).toBe("third time");
    expect(calls).toBe(3);
  });

  it("sends a request with a body once (a stream can't be replayed)", async () => {
    let calls = 0;
    const upstream = createUpstream({
      bindings: {
        API: fetcher(async () => {
          calls++;
          throw new Error("connection refused");
        }),
      },
    });
    const res = await gateway(upstream, {
      kind: "binding",
      target: "API",
      path: "/",
      retries: 5,
    }).fetch(
      new Request("https://gw.example/", { method: "POST", body: "payload" }),
    );
    expect(res.status).toBe(ERR.UPSTREAM_UNREACHABLE.status);
    expect(calls).toBe(1);
  });

  it("gives up when the upstream is too slow to answer", async () => {
    const upstream = createUpstream({
      bindings: {
        API: fetcher(async () => sleep(500).then(() => new Response("late"))),
      },
    });
    const started = Date.now();
    const res = await gateway(upstream, {
      kind: "binding",
      target: "API",
      path: "/",
      retries: 0,
      connectTimeoutMs: 10,
      readTimeoutMs: 10,
    }).fetch(new Request("https://gw.example/"));
    expect(res.status).toBe(ERR.UPSTREAM_UNREACHABLE.status);
    expect(Date.now() - started).toBeLessThan(400);
  });
});

describe("balancer", () => {
  const request = (headers: Record<string, string> = {}) => {
    const app = new Hono();
    let picked: string[] = [];
    return {
      app,
      run: async (balancer: Balancer) => {
        app.all("*", (c) => {
          picked = balancer.pick(c);
          return c.text("x");
        });
        await app.fetch(new Request("https://gw.example/", { headers }));
        return picked;
      },
    };
  };

  it("spreads round-robin by weight, evenly interleaved", async () => {
    const balancer = await createBalancer(
      { name: "b", algorithm: "round-robin" },
      [
        { target: "a:80", weight: 300 },
        { target: "b:80", weight: 100 },
      ],
    );
    const firsts: string[] = [];
    for (let i = 0; i < 8; i++)
      firsts.push((await request().run(balancer))[0] as string);
    expect(firsts.filter((t) => t === "a:80")).toHaveLength(6);
    expect(firsts.filter((t) => t === "b:80")).toHaveLength(2);
    expect(firsts.slice(0, 4).sort()).toEqual(["a:80", "a:80", "a:80", "b:80"]);
  });

  it("skips targets with weight 0", async () => {
    const balancer = await createBalancer({ name: "b" }, [
      { target: "a:80", weight: 0 },
      { target: "b:80", weight: 100 },
    ]);
    expect(await request().run(balancer)).toEqual(["b:80"]);
  });

  it("hashes consistently on a header, with the other targets as fallbacks", async () => {
    const targets = ["a:80", "b:80", "c:80"].map((target) => ({
      target,
      weight: 100,
    }));
    const upstream = {
      name: "b",
      algorithm: "consistent-hashing",
      hash_on: "header",
      hash_on_header: "x-user",
    };
    const one = await createBalancer(upstream, targets);
    const two = await createBalancer(upstream, targets); // another isolate: same ring
    const alice = await request({ "x-user": "alice" }).run(one);
    expect(await request({ "x-user": "alice" }).run(one)).toEqual(alice);
    expect(await request({ "x-user": "alice" }).run(two)).toEqual(alice);
    expect([...alice].sort()).toEqual(["a:80", "b:80", "c:80"]);
    const owners = new Set<string>();
    for (let i = 0; i < 30; i++)
      owners.add((await request({ "x-user": `u${i}` }).run(one))[0] as string);
    expect(owners.size).toBeGreaterThan(1);
  });

  it("stops picking a target after repeated failures (passive health)", async () => {
    const balancer = await createBalancer(
      {
        name: "b",
        healthchecks: { passive: { unhealthy: { tcp_failures: 2 } } },
      },
      [
        { target: "a:80", weight: 100 },
        { target: "b:80", weight: 100 },
      ],
    );
    balancer.report("a:80", { ok: false });
    balancer.report("a:80", { ok: false });
    await sleep(0);
    for (let i = 0; i < 4; i++)
      expect(await request().run(balancer)).toEqual(["b:80"]);
  });

  it("marks a default-port target unhealthy through forward()", async () => {
    // The test outbound service answers 502 for down.internal (vitest.config.ts).
    const balancer = await createBalancer(
      {
        name: "flaky.internal",
        healthchecks: {
          passive: {
            unhealthy: {
              http_failures: 2,
              http_statuses: [ERR.UPSTREAM_UNREACHABLE.status],
            },
          },
        },
      },
      [
        { target: "down.internal:80", weight: 100 },
        { target: "up.internal:80", weight: 100 },
      ],
    );
    const upstream = createUpstream({
      balancers: { "flaky.internal": balancer },
    });
    const app = gateway(upstream, {
      kind: "url",
      target: "http://flaky.internal:80",
      path: "/",
      retries: 1,
    });
    const unavailable = String(ERR.UPSTREAM_UNREACHABLE.status);
    for (let i = 0; i < 4; i++)
      await app.fetch(
        new Request("https://gw.example/", {
          headers: { "x-test-status": unavailable },
        }),
      );
    await sleep(0);
    for (let i = 0; i < 4; i++) {
      expect(await request().run(balancer)).toEqual(["up.internal:80"]);
    }
  });

  it("balances a URL target whose host is a Kong upstream name", async () => {
    const balancer = await createBalancer({ name: "backend.internal" }, [
      { target: "10.0.0.7:8080", weight: 100 },
    ]);
    const app = gateway(
      createUpstream({ balancers: { "backend.internal": balancer } }),
      {
        kind: "url",
        target: "http://backend.internal:80",
        path: "/health",
      },
    );
    const echo = await (
      await app.fetch(new Request("https://gw.example/"))
    ).json<Echo>();
    expect(echo.url).toBe("http://10.0.0.7:8080/health");
  });
});

describe("streaming (never buffers)", () => {
  const TOTAL = 50 * 1024 * 1024;
  const CHUNK = 64 * 1024;
  const BOUND = 8 * 1024 * 1024;

  /** A pull-based 50 MB stream that records how far ahead of its reader it gets. */
  function meteredStream() {
    const meter = { produced: 0, consumed: 0, maxAhead: 0 };
    const stream = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          if (meter.produced >= TOTAL) return controller.close();
          controller.enqueue(new Uint8Array(CHUNK));
          meter.produced += CHUNK;
          meter.maxAhead = Math.max(
            meter.maxAhead,
            meter.produced - meter.consumed,
          );
        },
      },
      { highWaterMark: 0 },
    );
    return { stream, meter };
  }

  async function drain(
    body: ReadableStream<Uint8Array>,
    onChunk: (n: number) => void,
  ) {
    const reader = body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      onChunk(value.byteLength);
    }
  }

  it("streams a 50 MB request body to the upstream", async () => {
    const { stream, meter } = meteredStream();
    const upstream = createUpstream({
      bindings: {
        API: fetcher(async (req) => {
          await drain(req.body as ReadableStream<Uint8Array>, (n) => {
            meter.consumed += n;
          });
          return new Response(String(meter.consumed));
        }),
      },
    });
    const res = await gateway(upstream, {
      kind: "binding",
      target: "API",
      path: "/upload",
    }).fetch(
      new Request("https://gw.example/upload", {
        method: "POST",
        body: stream,
        duplex: "half",
      } as RequestInit),
    );
    expect(await res.text()).toBe(String(TOTAL));
    expect(meter.maxAhead).toBeLessThan(BOUND);
  });

  it("streams a 50 MB response body to the client", async () => {
    const { stream, meter } = meteredStream();
    const upstream = createUpstream({
      bindings: { API: fetcher(async () => new Response(stream)) },
    });
    const res = await gateway(upstream, {
      kind: "binding",
      target: "API",
      path: "/download",
    }).fetch(new Request("https://gw.example/download"));
    await drain(res.body as ReadableStream<Uint8Array>, (n) => {
      meter.consumed += n;
    });
    expect(meter.consumed).toBe(TOTAL);
    expect(meter.maxAhead).toBeLessThan(BOUND);
  });
});

it("uses the shared header names", () => {
  expect(HEADER.cfAccessClientId).toBe("cf-access-client-id");
});
