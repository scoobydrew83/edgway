import type { PluginInstance } from "@edgway/core";
import { errorHandler } from "@edgway/errors";
import type { PluginInput } from "@edgway/plugin-sdk";
import { testApp } from "@edgway/plugin-sdk/testing";
import { Hono } from "hono";
import {
  base64url,
  exportSPKI,
  generateKeyPair,
  type JWTPayload,
  SignJWT,
} from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import jwt, {
  type JwtCredential,
  type JwtStore,
  setJwtStore,
} from "../src/index";

const SECRET = "a-very-long-hmac-secret-for-hs256-tests";
const B64_SECRET = new Uint8Array(32).map((_, i) =>
  i < 15 ? [0xfb, 0xef, 0xbe][i % 3] : 0xff,
);
const consumers = [
  { id: "c-alice", username: "alice", custom_id: "cust-1" },
  { id: "c-anon", username: "anonymous" },
];
const credentials: JwtCredential[] = [
  { id: "cred-hs", consumer_id: "c-alice", key: "alice-iss", secret: SECRET },
  {
    id: "cred-b64",
    consumer_id: "c-alice",
    key: "b64-iss",
    // base64url with "-" and "_" and no padding, as Kong accepts.
    secret: base64url.encode(B64_SECRET),
  },
  {
    id: "cred-orphan",
    consumer_id: "c-gone",
    key: "orphan-iss",
    secret: SECRET,
  },
  { id: "cred-nosecret", consumer_id: "c-alice", key: "empty-iss" },
  // A vault reference the gateway didn't resolve.
  {
    id: "cred-vault",
    consumer_id: "c-alice",
    key: "vault-iss",
    secret: "{vault://env/jwt-secret}",
  },
];
let rsaPrivate: CryptoKey;
let ecPrivate: CryptoKey;

const store: JwtStore = {
  credential: (key) => credentials.find((c) => c.key === key),
  consumer: (idOrUsername) =>
    consumers.find((c) => c.id === idOrUsername || c.username === idOrUsername),
};

beforeAll(async () => {
  const rsa = await generateKeyPair("RS256", { extractable: true });
  rsaPrivate = rsa.privateKey;
  credentials.push({
    id: "cred-rs",
    consumer_id: "c-alice",
    key: "rsa-iss",
    algorithm: "RS256",
    rsa_public_key: await exportSPKI(rsa.publicKey),
  });
  const ec = await generateKeyPair("ES256", { extractable: true });
  ecPrivate = ec.privateKey;
  credentials.push({
    id: "cred-es",
    consumer_id: "c-alice",
    key: "ec-iss",
    algorithm: "ES256",
    rsa_public_key: await exportSPKI(ec.publicKey),
  });
});

const hs = (claims: JWTPayload, secret = SECRET, header = {}) =>
  new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256", ...header })
    .sign(new TextEncoder().encode(secret));

const withStore: PluginInstance = {
  id: "store",
  name: "store",
  priority: Number.MAX_SAFE_INTEGER,
  scope: {},
  handlers: {
    access: async (c, next) => {
      setJwtStore(c, store);
      await next();
    },
  },
};

const app = (config: PluginInput<typeof jwt.config> = {}) =>
  testApp(jwt, config, { plugins: [withStore] });
const bearer = (token: string) => ({
  headers: { authorization: `Bearer ${token}` },
});
const now = () => Math.floor(Date.now() / 1000);
type Echo = { headers: Record<string, string> };

async function expectRejected(res: Response, code: string, claim?: string) {
  expect(res.status).toBe(401);
  expect(res.headers.get("www-authenticate")).toBe(
    'Bearer error="invalid_token"',
  );
  const body = await res.json();
  expect(body).toMatchObject({ code });
  if (claim) expect(body).toMatchObject({ claim });
}

describe("jwt", () => {
  it("uses Kong's name, priority and defaults", () => {
    expect(jwt.name).toBe("jwt");
    expect(jwt.priority).toBe(1450);
    expect(jwt.parse({})).toMatchObject({
      header_names: ["authorization"],
      uri_param_names: ["jwt"],
      cookie_names: [],
      key_claim_name: "iss",
      maximum_expiration: 0,
      secret_is_base64: false,
      run_on_preflight: true,
    });
  });

  it("authenticates an HS256 Bearer token and sets Kong's consumer headers", async () => {
    const res = await app().request(
      "/",
      bearer(await hs({ iss: "alice-iss" })),
    );
    expect(res.status).toBe(200);
    const echo = (await res.json()) as Echo;
    expect(echo.headers).toMatchObject({
      "x-consumer-id": "c-alice",
      "x-consumer-username": "alice",
      "x-consumer-custom-id": "cust-1",
      "x-credential-identifier": "alice-iss",
    });
    expect(echo.headers).not.toHaveProperty("x-anonymous-consumer");
  });

  it("reads tokens from uri_param_names and cookie_names", async () => {
    const token = await hs({ iss: "alice-iss" });
    expect((await app().request(`/?jwt=${token}`)).status).toBe(200);
    const cookie = await app({ cookie_names: ["session"] }).request("/", {
      headers: { cookie: `session=${token}` },
    });
    expect(cookie.status).toBe(200);
  });

  it("answers a missing token with 401 Unauthorized and a plain Bearer challenge", async () => {
    const res = await app().request("/");
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe("Bearer");
    expect(await res.json()).toMatchObject({ code: "EDG-AUTH-004" });
    const realm = await app({ realm: "edgway" }).request("/");
    expect(realm.headers.get("www-authenticate")).toBe('Bearer realm="edgway"');
  });

  it("adds error=invalid_token (and the realm) when a sent token is rejected", async () => {
    const res = await app({ realm: "edgway" }).request("/", bearer("x.y.z"));
    expect(res.headers.get("www-authenticate")).toBe(
      'Bearer realm="edgway" error="invalid_token"',
    );
  });

  it("rejects a token whose consumer no longer exists, like Kong", async () => {
    const token = await hs({ iss: "orphan-iss" });
    await expectRejected(
      await app().request("/", bearer(token)),
      "EDG-AUTH-017",
      "iss",
    );
    const anon = await app({ anonymous: "c-anon" }).request("/", bearer(token));
    expect(anon.status).toBe(200);
  });

  it("rejects multiple distinct tokens", async () => {
    const a = await hs({ iss: "alice-iss" });
    const b = await hs({ iss: "alice-iss", sub: "other" });
    await expectRejected(
      await app().request(`/?jwt=${a}`, bearer(b)),
      "EDG-AUTH-005",
    );
    expect((await app().request(`/?jwt=${a}`, bearer(a))).status).toBe(200);
  });

  it("rejects a token that cannot be decoded", async () => {
    await expectRejected(
      await app().request("/", bearer("not.a.jwt")),
      "EDG-AUTH-006",
    );
  });

  it("requires the key claim, from the claims or the header", async () => {
    await expectRejected(
      await app().request("/", bearer(await hs({ sub: "x" }))),
      "EDG-AUTH-007",
      "iss",
    );
    await expectRejected(
      await app().request("/", bearer(await hs({ iss: "" }))),
      "EDG-AUTH-008",
      "iss",
    );
    const kid = await hs({}, SECRET, { kid: "alice-iss" });
    expect(
      (await app({ key_claim_name: "kid" }).request("/", bearer(kid))).status,
    ).toBe(200);
  });

  it("rejects an unknown key", async () => {
    await expectRejected(
      await app().request("/", bearer(await hs({ iss: "nobody" }))),
      "EDG-AUTH-009",
    );
  });

  it("rejects a token whose algorithm differs from the credential's", async () => {
    const token = await hs({ iss: "rsa-iss" });
    await expectRejected(
      await app().request("/", bearer(token)),
      "EDG-AUTH-010",
    );
  });

  it("rejects when the credential has no usable secret", async () => {
    await expectRejected(
      await app().request("/", bearer(await hs({ iss: "empty-iss" }))),
      "EDG-AUTH-011",
    );
  });

  it("never uses an unresolved vault reference as the HMAC key", async () => {
    const forged = await hs({ iss: "vault-iss" }, "{vault://env/jwt-secret}");
    await expectRejected(
      await app().request("/", bearer(forged)),
      "EDG-AUTH-011",
    );
  });

  it("rejects a bad signature", async () => {
    const token = await hs(
      { iss: "alice-iss" },
      "the-wrong-secret-entirely-00000",
    );
    await expectRejected(
      await app().request("/", bearer(token)),
      "EDG-AUTH-012",
    );
  });

  it("checks exp and nbf only when listed in claims_to_verify", async () => {
    const expired = await hs({ iss: "alice-iss", exp: now() - 10 });
    expect((await app().request("/", bearer(expired))).status).toBe(200);
    const verifying = app({ claims_to_verify: ["exp", "nbf"] });
    await expectRejected(
      await verifying.request("/", bearer(expired)),
      "EDG-AUTH-013",
      "exp",
    );
    const early = await hs({
      iss: "alice-iss",
      exp: now() + 60,
      nbf: now() + 60,
    });
    await expectRejected(
      await verifying.request("/", bearer(early)),
      "EDG-AUTH-014",
      "nbf",
    );
    const noExp = await hs({ iss: "alice-iss", nbf: now() - 1 });
    await expectRejected(
      await verifying.request("/", bearer(noExp)),
      "EDG-AUTH-016",
      "exp",
    );
    const valid = await hs({
      iss: "alice-iss",
      exp: now() + 60,
      nbf: now() - 1,
    });
    expect((await verifying.request("/", bearer(valid))).status).toBe(200);
  });

  it("enforces maximum_expiration", async () => {
    const t = app({ claims_to_verify: ["exp"], maximum_expiration: 60 });
    const long = await hs({ iss: "alice-iss", exp: now() + 3600 });
    await expectRejected(
      await t.request("/", bearer(long)),
      "EDG-AUTH-015",
      "exp",
    );
    const short = await hs({ iss: "alice-iss", exp: now() + 30 });
    expect((await t.request("/", bearer(short))).status).toBe(200);
  });

  it("decodes base64url secrets with secret_is_base64, as Kong does", async () => {
    const token = await new SignJWT({ iss: "b64-iss" })
      .setProtectedHeader({ alg: "HS256" })
      .sign(B64_SECRET);
    const encoded = credentials.find((c) => c.key === "b64-iss")?.secret;
    expect(encoded).toMatch(/-/);
    expect(encoded).toMatch(/_/);
    expect(encoded).not.toMatch(/=/);
    expect(
      (await app({ secret_is_base64: true }).request("/", bearer(token)))
        .status,
    ).toBe(200);
    await expectRejected(
      await app().request("/", bearer(token)),
      "EDG-AUTH-012",
    );
  });

  it("verifies RS256 and ES256 tokens with the credential's PEM public key", async () => {
    const rs = await new SignJWT({ iss: "rsa-iss" })
      .setProtectedHeader({ alg: "RS256" })
      .sign(rsaPrivate);
    expect((await app().request("/", bearer(rs))).status).toBe(200);
    const es = await new SignJWT({ iss: "ec-iss" })
      .setProtectedHeader({ alg: "ES256" })
      .sign(ecPrivate);
    expect((await app().request("/", bearer(es))).status).toBe(200);
  });

  it("falls back to the anonymous consumer", async () => {
    const t = app({ anonymous: "anonymous" });
    for (const init of [{}, bearer("not.a.jwt")]) {
      const res = await t.request("/", init);
      expect(res.status).toBe(200);
      expect(((await res.json()) as Echo).headers).toMatchObject({
        "x-consumer-id": "c-anon",
        "x-anonymous-consumer": "true",
      });
    }
    expect((await app({ anonymous: "ghost" }).request("/")).status).toBe(500);
  });

  it("lets OPTIONS through when run_on_preflight is false", async () => {
    const off = app({ run_on_preflight: false });
    expect((await off.request("/", { method: "OPTIONS" })).status).toBe(200);
    expect((await app().request("/", { method: "OPTIONS" })).status).toBe(401);
  });

  it("fails closed without a credential store", async () => {
    const res = await testApp(jwt, {}).request(
      "/",
      bearer(await hs({ iss: "alice-iss" })),
    );
    expect(res.status).toBe(500);
  });

  it("is also plain Hono middleware", async () => {
    const plain = new Hono();
    plain.onError(errorHandler());
    plain.use(async (c, next) => {
      setJwtStore(c, store);
      await next();
    });
    plain.use(jwt.middleware({}));
    plain.get("/", (c) => c.text("ok"));
    const token = await hs({ iss: "alice-iss" });
    expect(await (await plain.request("/", bearer(token))).text()).toBe("ok");
    expect((await plain.request("/")).status).toBe(401);
  });
});
