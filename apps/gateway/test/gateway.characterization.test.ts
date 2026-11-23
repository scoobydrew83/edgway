/**
 * Characterization tests: lock in the scaffold gateway's current external
 * behavior (status codes, headers, body shapes) before the package refactor.
 * Expected values mirror today's behavior, not the
 * target design. Later tasks update them only where a wire change is intended.
 */

import { exports } from "cloudflare:workers";
import { GATEWAY_ENDPOINTS, HEADER } from "@edgway/constants";
import { describe, expect, it } from "vitest";

const BASE = "https://gateway.test";
const SEED_KEY = "edgway_dev_seed_key_do_not_use_in_prod";

let ipCounter = 0;
/** Unique client IP per call, so IP-keyed rate-limit buckets never collide. */
const freshIp = () => `203.0.113.${++ipCounter}`;

/** Error responses are RFC 9457 problem+json with a stable Edgway code. */
async function expectProblem(res: Response, status: number, code: string) {
  expect(res.status).toBe(status);
  expect(res.headers.get("content-type")).toContain("application/problem+json");
  const body = await res.json<Record<string, unknown>>();
  expect(body).toMatchObject({ status, code });
  return body;
}

function call(path: string, headers: Record<string, string> = {}) {
  return exports.default.fetch(
    new Request(`${BASE}${path}`, {
      headers: { "CF-Connecting-IP": freshIp(), ...headers },
    }),
  );
}

describe("service endpoints", () => {
  it(`GET ${GATEWAY_ENDPOINTS.health} returns ok`, async () => {
    const res = await call(GATEWAY_ENDPOINTS.health);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, service: "edgway" });
    // every response carries a request id.
    expect(res.headers.get(HEADER.requestId)).toMatch(/\S+/);
  });

  it(`GET ${GATEWAY_ENDPOINTS.info} describes the service`, async () => {
    const res = await call(GATEWAY_ENDPOINTS.info);
    expect(res.status).toBe(200);
    const body = await res.json<Record<string, unknown>>();
    expect(body).toMatchObject({
      name: "edgway",
      health: GATEWAY_ENDPOINTS.health,
    });
    // The admin moved out of the gateway (the admin Worker is Step 5).
    expect(body).not.toHaveProperty("admin");
  });

  it("leaves / and /health to the routes", async () => {
    // No route matches them in this snapshot: the data plane answers.
    for (const path of ["/", "/health"]) {
      await expectProblem(await call(path), 404, "EDG-CFG-001");
    }
  });

  it("unmatched path returns 404 EDG-CFG-001", async () => {
    const res = await call("/nothing/here");
    const body = await expectProblem(res, 404, "EDG-CFG-001");
    expect(body).toMatchObject({ method: "GET", path: "/nothing/here" });
  });
});

describe("localized errors", () => {
  it("returns English problem titles by default", async () => {
    const body = await expectProblem(
      await call("/nothing/here"),
      404,
      "EDG-CFG-001",
    );
    expect(body.title).toBe("No route matches this request");
  });

  it("returns pseudo-localized titles for Accept-Language: x-pseudo", async () => {
    const res = await call("/nothing/here", { "Accept-Language": "x-pseudo" });
    const body = await expectProblem(res, 404, "EDG-CFG-001");
    expect(body.title).toMatch(/^\[.+\]$/);
    expect(body.title).not.toBe("No route matches this request");
  });
});

describe("public proxy route /demo/ip", () => {
  it("proxies to the upstream with the path rewrite and route header", async () => {
    const res = await call("/demo/ip");
    expect(res.status).toBe(200);
    // Shown to traced requests only.
    expect(res.headers.get(HEADER.route)).toBeNull();
    const body = await res.json<{ url: string; method: string }>();
    expect(body.url).toBe("https://httpbin.org/ip");
    expect(body.method).toBe("GET");
  });

  it("caches GET responses: Kong's X-Cache-Status Miss then Hit", async () => {
    const first = await call("/demo/ip?cache=probe");
    expect(first.status).toBe(200);
    expect(first.headers.get(HEADER.cacheStatus)).toBe("Miss");
    await first.arrayBuffer();

    // The cache write happens in waitUntil; poll briefly for the Hit.
    let cacheHeader: string | null = null;
    for (let i = 0; i < 20 && cacheHeader !== "Hit"; i++) {
      const next = await call("/demo/ip?cache=probe");
      cacheHeader = next.headers.get(HEADER.cacheStatus);
      await next.arrayBuffer();
      if (cacheHeader !== "Hit") await scheduler.wait(25);
    }
    expect(cacheHeader).toBe("Hit");
  });
});

describe("API-key route /demo/httpbin", () => {
  it("rejects requests without a key with 401 EDG-AUTH-002 (Kong's key-auth)", async () => {
    const res = await call("/demo/httpbin");
    await expectProblem(res, 401, "EDG-AUTH-002");
  });

  it("rejects an unknown key with 401", async () => {
    const res = await call("/demo/httpbin", { "X-Api-Key": "edg_not_a_key" });
    expect(res.status).toBe(401);
  });

  it("accepts the seed key via X-Api-Key and proxies to /anything", async () => {
    const res = await call("/demo/httpbin", { "X-Api-Key": SEED_KEY });
    expect(res.status).toBe(200);
    expect(res.headers.get("X-RateLimit-Limit-Minute")).toBe("30");
    const body = await res.json<{ url: string }>();
    expect(body.url).toBe("https://httpbin.org/anything");
  });

  it("passes POST bodies through to the upstream intact", async () => {
    const res = await exports.default.fetch(
      new Request(`${BASE}/demo/httpbin`, {
        method: "POST",
        headers: { "X-Api-Key": SEED_KEY, "CF-Connecting-IP": freshIp() },
        body: "hello upstream",
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      method: "POST",
      body: "hello upstream",
    });
  });

  it("accepts the seed key in the query and hides it from the upstream", async () => {
    const res = await call(`/demo/httpbin?X-Api-Key=${SEED_KEY}&keep=1`);
    expect(res.status).toBe(200);
    const body = await res.json<{ url: string }>();
    expect(body.url).toBe("https://httpbin.org/anything?keep=1");
  });

  it("returns 429 once the per-IP limit (30/min) is exhausted", async () => {
    const ip = "198.51.100.77";
    const headers = { "X-Api-Key": SEED_KEY, "CF-Connecting-IP": ip };
    for (let i = 0; i < 30; i++) {
      const ok = await call("/demo/httpbin", headers);
      expect(ok.status).toBe(200);
      await ok.arrayBuffer();
    }
    const limited = await call("/demo/httpbin", headers);
    expect(limited.headers.get("Retry-After")).not.toBeNull();
    expect(limited.headers.get("X-RateLimit-Limit-Minute")).toBe("30");
    expect(limited.headers.get("X-RateLimit-Remaining-Minute")).toBe("0");
    await expectProblem(limited, 429, "EDG-RL-001");
  });
});
