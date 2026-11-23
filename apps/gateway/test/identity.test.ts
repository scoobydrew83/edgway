/** consumer groups, spoofed identity headers and Kong's logical OR, with the real plugins. */
import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { HEADER, IDENTITY_HEADERS } from "@edgway/constants";
import { importJWK, type JWK, SignJWT } from "jose";
import { describe, expect, it } from "vitest";

type Echo = { headers: Record<string, string> };

let ip = 0;
const call = (path: string, headers: Record<string, string> = {}) =>
  exports.default.fetch(
    new Request(`https://gateway.test${path}`, {
      headers: { "CF-Connecting-IP": `198.51.100.${++ip}`, ...headers },
    }),
  );

/** Every identity header only the gateway may set, sent by the client. */
const SPOOFED: Record<string, string> = Object.fromEntries(
  IDENTITY_HEADERS.map((name) => [name, `spoofed-${name}`]),
);

describe("identity headers", () => {
  it("never reach the upstream from the client on a route without auth", async () => {
    const res = await call("/demo/ip", SPOOFED);
    expect(res.status).toBe(200);
    const { headers } = await res.json<Echo>();
    for (const name of Object.keys(SPOOFED)) {
      expect(headers).not.toHaveProperty(name);
    }
  });

  it("never reach the upstream through openid-connect without a mapped consumer", async () => {
    const key = await importJWK(JSON.parse(env.TEST_IDP_KEY) as JWK, "RS256");
    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({
      sub: "someone",
      iat: now,
      exp: now + 300,
    })
      .setIssuer(env.TEST_IDP_ISSUER)
      .setProtectedHeader({ alg: "RS256", kid: "idp-1" })
      .sign(key);
    const res = await call("/oidc", {
      ...SPOOFED,
      authorization: `Bearer ${token}`,
    });
    expect(res.status).toBe(200);
    const { headers } = await res.json<Echo>();
    for (const name of IDENTITY_HEADERS) {
      expect(headers).not.toHaveProperty(name);
    }
  });

  it("are the gateway's own on an authenticated route", async () => {
    const res = await call("/identity", {
      ...SPOOFED,
      "x-api-key": "plain-key",
    });
    expect(res.status).toBe(200);
    const { headers } = await res.json<Echo>();
    expect(headers[HEADER.consumerId]).toBe("consumer_plain");
    expect(headers[HEADER.consumerUsername]).toBe("plain-user");
    for (const name of IDENTITY_HEADERS) {
      // Only what key-auth set itself survives.
      if (headers[name] !== undefined) {
        expect(headers[name]).not.toBe(SPOOFED[name]);
      }
    }
  });
});

describe("consumer groups", () => {
  it("apply a group-scoped rate limit to members only", async () => {
    const gold = () => call("/identity", { "x-api-key": "gold-key" });
    const plain = () => call("/identity", { "x-api-key": "plain-key" });
    expect((await gold()).status).toBe(200);
    expect((await gold()).status).toBe(429);
    expect((await plain()).status).toBe(200);
    expect((await plain()).status).toBe(200);
  });
});

describe("Kong's logical OR between auth plugins", () => {
  it("keeps the jwt consumer when key-auth would fall back to anonymous", async () => {
    const token = await new SignJWT({ iss: "vault-issuer" })
      .setProtectedHeader({ alg: "HS256" })
      .sign(new TextEncoder().encode("gateway-test-jwt-secret"));
    const res = await call("/identity", { authorization: `Bearer ${token}` });
    expect(res.status).toBe(200);
    const { headers } = await res.json<Echo>();
    expect(headers[HEADER.consumerId]).toBe("consumer_vault");
    expect(headers).not.toHaveProperty(HEADER.anonymousConsumer);
  });

  it("falls back to anonymous when no plugin finds a credential", async () => {
    const res = await call("/identity");
    const { headers } = await res.json<Echo>();
    expect(headers[HEADER.consumerId]).toBe("consumer_anon");
    expect(headers[HEADER.anonymousConsumer]).toBe("true");
  });
});
