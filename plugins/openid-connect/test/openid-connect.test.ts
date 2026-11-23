import { getConsumer, type PluginInstance } from "@edgway/core";
import { ERR, errorHandler } from "@edgway/errors";
import type { PluginInput } from "@edgway/plugin-sdk";
import { testApp } from "@edgway/plugin-sdk/testing";
import { Hono } from "hono";
import {
  exportJWK,
  generateKeyPair,
  type JWK,
  type JWTPayload,
  SignJWT,
} from "jose";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import oidc, { type OidcStore, setOidcStore } from "../src/index";

const ISSUER = "https://idp.test";
const CLIENT = "edgway-client";
let signingKey: CryptoKey;
let otherKey: CryptoKey;
let jwk: JWK;
/** The nonce the fake IdP puts in the next ID token. */
let nextNonce = "";

const consumers = [
  { id: "c-alice", username: "alice", custom_id: "cust-1" },
  { id: "c-anon", username: "anonymous" },
];
const store: OidcStore = {
  consumer: (by, value) => consumers.find((c) => c[by] === value),
};

/** A fake IdP: discovery, JWKS and the token endpoint. */
async function idp(input: RequestInfo | URL) {
  const url = new URL(input instanceof Request ? input.url : String(input));
  // An unreachable IdP (a network failure).
  if (url.origin === "https://down.test") throw new TypeError("unreachable");
  switch (url.pathname) {
    // Any origin is an issuer with the same keys (a second one).
    case "/.well-known/openid-configuration":
      return Response.json({
        issuer: url.origin,
        jwks_uri: `${url.origin}/jwks`,
        authorization_endpoint: `${url.origin}/authorize`,
        token_endpoint: `${url.origin}/token`,
        response_types_supported: ["code"],
        scopes_supported: ["openid", "email", "profile"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
      });
    case "/jwks":
      return Response.json({ keys: [jwk] });
    case "/token": {
      const id_token = await sign({
        iss: url.origin,
        sub: "alice",
        aud: CLIENT,
        nonce: nextNonce,
      });
      return Response.json({
        access_token: "opaque-access",
        token_type: "Bearer",
        expires_in: 300,
        refresh_token: "refresh",
        id_token,
      });
    }
  }
  return new Response(null, { status: ERR.ROUTE_NOT_FOUND.status });
}

beforeAll(async () => {
  const pair = await generateKeyPair("RS256", { extractable: true });
  signingKey = pair.privateKey;
  jwk = { ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "RS256" };
  otherKey = (await generateKeyPair("RS256")).privateKey;
  vi.spyOn(globalThis, "fetch").mockImplementation(idp as typeof fetch);
});
afterAll(() => vi.restoreAllMocks());

const now = () => Math.floor(Date.now() / 1000);
const sign = (claims: JWTPayload, key = signingKey) =>
  new SignJWT({ iss: ISSUER, iat: now(), exp: now() + 300, ...claims })
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .sign(key);

const withStore: PluginInstance = {
  id: "store",
  name: "store",
  priority: Number.MAX_SAFE_INTEGER,
  scope: {},
  handlers: {
    access: async (c, next) => {
      setOidcStore(c, store);
      await next();
    },
  },
};
type Config = PluginInput<typeof oidc.config>;
const bearerOnly = (config: Partial<Config> = {}): Config => ({
  issuer: ISSUER,
  auth_methods: ["bearer"],
  ...config,
});
const app = (config: Config) => testApp(oidc, config, { plugins: [withStore] });
const bearer = (token: string) => ({
  headers: { authorization: `Bearer ${token}` },
});
type Echo = { url: string; headers: Record<string, string> };

describe("openid-connect: bearer", () => {
  it("uses Kong's name, priority and defaults", () => {
    expect(oidc.name).toBe("openid-connect");
    expect(oidc.priority).toBe(1050);
    expect(oidc.parse({ issuer: ISSUER })).toMatchObject({
      bearer_token_param_type: ["body", "header", "query"],
      consumer_by: ["custom_id", "username"],
      scopes_claim: ["scope"],
      upstream_access_token_header: "authorization:bearer",
    });
  });

  it("accepts a token signed by the issuer's JWKS and passes it upstream", async () => {
    const token = await sign({ sub: "alice" });
    const res = await app(bearerOnly()).request("/", bearer(token));
    expect(res.status).toBe(200);
    const echo = (await res.json()) as Echo;
    expect(echo.headers.authorization).toBe(`Bearer ${token}`);
  });

  it("answers a missing token with 401 and a Bearer challenge", async () => {
    const res = await app(bearerOnly()).request("/");
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe(
      'Bearer realm="gateway.test"',
    );
    expect(await res.json()).toMatchObject({
      code: "EDG-AUTH-004",
      detail: "Unauthorized",
    });
  });

  it("rejects bad signatures, expired tokens and other issuers", async () => {
    const t = app(bearerOnly());
    for (const token of [
      await sign({ sub: "alice" }, otherKey),
      await sign({ sub: "alice", exp: now() - 10 }),
      await sign({ sub: "alice", iss: "https://evil.test" }),
    ]) {
      const res = await t.request("/", bearer(token));
      expect(res.status).toBe(401);
      expect(res.headers.get("www-authenticate")).toBe(
        'Bearer realm="gateway.test" error="invalid_token"',
      );
    }
  });

  it("accepts issuers_allowed and checks the configured audience", async () => {
    const other = await sign({ iss: "https://alias.test" });
    expect(
      (
        await app(
          bearerOnly({ issuers_allowed: ["https://alias.test"] }),
        ).request("/", bearer(other))
      ).status,
    ).toBe(200);
    const t = app(bearerOnly({ audience: ["api"] }));
    expect(
      (await t.request("/", bearer(await sign({ aud: "api" })))).status,
    ).toBe(200);
    expect(
      (await t.request("/", bearer(await sign({ aud: "web" })))).status,
    ).toBe(401);
  });

  it("checks the audience against client_id when audience is empty", async () => {
    const t = app(bearerOnly({ client_id: ["this-app"] }));
    expect(
      (await t.request("/", bearer(await sign({ aud: "this-app" })))).status,
    ).toBe(200);
    // A token the same IdP issued for another application.
    expect(
      (await t.request("/", bearer(await sign({ aud: "other-app" })))).status,
    ).toBe(401);
    // With neither audience nor client_id there is nothing to compare.
    expect(
      (await app(bearerOnly()).request("/", bearer(await sign({ aud: "x" }))))
        .status,
    ).toBe(200);
  });

  it("enforces scopes_required as alternatives of all-required values", async () => {
    const t = app(bearerOnly({ scopes_required: ["read write", "admin"] }));
    const ok = [
      await sign({ scope: "openid read write" }),
      await sign({ scope: "admin" }),
    ];
    for (const token of ok)
      expect((await t.request("/", bearer(token))).status).toBe(200);
    const res = await t.request("/", bearer(await sign({ scope: "read" })));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      code: "EDG-AUTH-018",
      detail: "Forbidden",
    });
  });

  it("enforces groups_required and roles_required from array claims", async () => {
    const t = app(
      bearerOnly({ groups_required: ["staff"], roles_required: ["editor"] }),
    );
    const ok = await sign({ groups: ["staff"], roles: ["editor", "x"] });
    expect((await t.request("/", bearer(ok))).status).toBe(200);
    const bad = await sign({ groups: ["staff"], roles: ["viewer"] });
    expect((await t.request("/", bearer(bad))).status).toBe(403);
  });

  it("reads access_token from the query and a cookie, and hides the query token", async () => {
    const token = await sign({ sub: "alice" });
    const t = app(bearerOnly({ hide_credentials: true }));
    const res = await t.request(`/p?access_token=${token}&keep=1`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as Echo).url).toBe(
      "https://gateway.test/p?keep=1",
    );
    const cookie = await app(
      bearerOnly({
        bearer_token_param_type: ["cookie"],
        bearer_token_cookie_name: "at",
      }),
    ).request("/", { headers: { cookie: `at=${token}` } });
    expect(cookie.status).toBe(200);
  });

  it("maps the consumer from consumer_claim and consumer_by", async () => {
    const t = app(
      bearerOnly({ consumer_claim: ["sub"], consumer_by: ["username"] }),
    );
    const res = await t.request("/", bearer(await sign({ sub: "alice" })));
    expect(res.status).toBe(200);
    expect(((await res.json()) as Echo).headers).toMatchObject({
      "x-consumer-id": "c-alice",
      "x-consumer-username": "alice",
      "x-credential-identifier": "alice",
    });
    const missing = await t.request("/", bearer(await sign({ sub: "bob" })));
    expect(missing.status).toBe(403);
    const optional = app(
      bearerOnly({
        consumer_claim: ["sub"],
        consumer_by: ["username"],
        consumer_optional: true,
      }),
    );
    const res2 = await optional.request(
      "/",
      bearer(await sign({ sub: "bob" })),
    );
    expect(res2.status).toBe(200);
    expect(((await res2.json()) as Echo).headers).not.toHaveProperty(
      "x-consumer-id",
    );
  });

  it("sets consumer groups from authenticated_groups_claim", async () => {
    let groups: string[] | undefined;
    const t = testApp(
      oidc,
      bearerOnly({
        consumer_claim: ["sub"],
        consumer_by: ["username"],
        authenticated_groups_claim: ["groups"],
      }),
      {
        plugins: [withStore],
        upstream: (c) => {
          groups = getConsumer(c)?.groups;
          return c.text("ok");
        },
      },
    );
    await t.request(
      "/",
      bearer(await sign({ sub: "alice", groups: ["a", "b"] })),
    );
    expect(groups).toEqual(["a", "b"]);
  });

  it("sends mapped claims upstream", async () => {
    const t = app(
      bearerOnly({
        upstream_headers_claims: ["email", "roles"],
        upstream_headers_names: ["x-user-email", "x-user-roles"],
      }),
    );
    const token = await sign({ email: "a@example.test", roles: ["r1", "r2"] });
    const echo = (await (await t.request("/", bearer(token))).json()) as Echo;
    expect(echo.headers).toMatchObject({
      "x-user-email": "a@example.test",
      "x-user-roles": "r1,r2",
      authorization: `Bearer ${token}`,
    });
  });

  it("never passes a client's copies of the mapped headers upstream", async () => {
    const t = app(
      bearerOnly({
        anonymous: "anonymous",
        upstream_headers_claims: ["role"],
        upstream_headers_names: ["x-user-role"],
        upstream_access_token_header: "x-access-token",
      }),
    );
    const forged = { "x-user-role": "admin", "x-access-token": "forged" };
    // A valid token without the claim: no header, not the client's.
    const token = await sign({ sub: "alice" });
    const verified = (await (
      await t.request("/", {
        headers: { authorization: `Bearer ${token}`, ...forged },
      })
    ).json()) as Echo;
    expect(verified.headers).not.toHaveProperty("x-user-role");
    expect(verified.headers["x-access-token"]).toBe(token);
    // The anonymous consumer: neither header survives.
    const anonymous = (await (
      await t.request("/", { headers: forged })
    ).json()) as Echo;
    expect(anonymous.headers["x-consumer-id"]).toBe("c-anon");
    expect(anonymous.headers).not.toHaveProperty("x-user-role");
    expect(anonymous.headers).not.toHaveProperty("x-access-token");
    // A bad token, then the anonymous consumer: no token header either.
    const rejected = (await (
      await t.request("/", {
        headers: { authorization: "Bearer not-a-jwt", ...forged },
      })
    ).json()) as Echo;
    expect(rejected.headers["x-consumer-id"]).toBe("c-anon");
    expect(rejected.headers).not.toHaveProperty("x-access-token");
  });

  it("falls back to the anonymous consumer on 401 only", async () => {
    const t = app(
      bearerOnly({ anonymous: "anonymous", scopes_required: ["admin"] }),
    );
    const res = await t.request("/");
    expect(res.status).toBe(200);
    expect(((await res.json()) as Echo).headers).toMatchObject({
      "x-consumer-id": "c-anon",
      "x-anonymous-consumer": "true",
    });
    expect(
      (await t.request("/", bearer(await sign({ scope: "read" })))).status,
    ).toBe(403);
  });

  it("fails with 500 when the issuer cannot be discovered", async () => {
    const res = await app(bearerOnly({ issuer: "https://down.test" })).request(
      "/",
      bearer(await sign({})),
    );
    expect(res.status).toBe(500);
  });

  it("lets OPTIONS through when run_on_preflight is false", async () => {
    const t = app(bearerOnly({ run_on_preflight: false }));
    expect((await t.request("/", { method: "OPTIONS" })).status).toBe(200);
  });

  it("is also plain Hono middleware", async () => {
    const plain = new Hono();
    plain.onError(errorHandler());
    plain.use(oidc.middleware(bearerOnly()));
    plain.get("/", (c) => c.text("ok"));
    const ok = await plain.request("/", bearer(await sign({})));
    expect(await ok.text()).toBe("ok");
    expect((await plain.request("/")).status).toBe(401);
  });
});

describe("openid-connect: session login (authorization_code)", () => {
  const config: Config = {
    issuer: ISSUER,
    auth_methods: ["authorization_code", "session"],
    client_id: [CLIENT],
    client_secret: ["client-secret"],
    session_secret: "a-session-secret-that-is-at-least-32-chars",
    redirect_uri: ["https://gateway.test/callback"],
    consumer_claim: ["sub"],
    consumer_by: ["username"],
  };
  const cookiesOf = (res: Response) =>
    Object.fromEntries(
      (res.headers as unknown as { getSetCookie(): string[] })
        .getSetCookie()
        .map((c: string) => {
          const [pair = ""] = c.split(";");
          const i = pair.indexOf("=");
          return [pair.slice(0, i), pair.slice(i + 1)];
        }),
    );
  const cookieHeader = (jar: Record<string, string>) =>
    Object.entries(jar)
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");

  it("redirects to the issuer, completes the callback and serves the session", async () => {
    const t = app(config);
    const login = await t.request("/app?x=1");
    expect(login.status).toBe(302);
    const authorize = new URL(login.headers.get("location") ?? "");
    expect(authorize.origin + authorize.pathname).toBe(`${ISSUER}/authorize`);
    expect(authorize.searchParams.get("client_id")).toBe(CLIENT);
    expect(authorize.searchParams.get("redirect_uri")).toBe(
      "https://gateway.test/callback",
    );
    expect(t.upstreamCalls).toHaveLength(0);

    nextNonce = authorize.searchParams.get("nonce") ?? "";
    const jar = cookiesOf(login);
    const state = authorize.searchParams.get("state");
    const callback = await t.request(
      `/callback?code=good-code&state=${state}`,
      { headers: { cookie: cookieHeader(jar) } },
    );
    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe(
      "https://gateway.test/app?x=1",
    );
    const session = cookiesOf(callback).session;
    expect(session).toBeTruthy();

    const res = await t.request("/app?x=1", {
      headers: { cookie: `session=${session}` },
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as Echo).headers).toMatchObject({
      "x-consumer-id": "c-alice",
      "x-credential-identifier": "alice",
    });
  });

  /** A session cookie from a full login against `cfg`. */
  async function login(cfg: Config) {
    const t = app(cfg);
    const start = await t.request("/app");
    const authorize = new URL(start.headers.get("location") ?? "");
    nextNonce = authorize.searchParams.get("nonce") ?? "";
    const callback = await t.request(
      `/callback?code=good-code&state=${authorize.searchParams.get("state")}`,
      { headers: { cookie: cookieHeader(cookiesOf(start)) } },
    );
    return cookiesOf(callback).session ?? "";
  }

  it("refuses a session another instance issued", async () => {
    const session = await login(config);
    const sessionOnly: Config = { ...config, auth_methods: ["session"] };
    const headers = { cookie: `session=${session}` };
    // The instance that issued it accepts it.
    expect(
      (await app({ ...sessionOnly }).request("/", { headers })).status,
    ).toBe(200);
    // Same secret and cookie, another issuer or client: refused.
    const otherIssuer = { ...sessionOnly, issuer: "https://idp2.test" };
    expect((await app(otherIssuer).request("/", { headers })).status).toBe(401);
    const otherClient = { ...sessionOnly, client_id: ["another-client"] };
    expect((await app(otherClient).request("/", { headers })).status).toBe(401);
  });

  it("answers 401 with session only (no login redirect) when there is no session", async () => {
    const res = await app({ ...config, auth_methods: ["session"] }).request(
      "/app",
    );
    expect(res.status).toBe(401);
  });
});
