/** jwt secrets published as vault references are resolved, never used literally. */
import { exports } from "cloudflare:workers";
import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";

const token = (secret: string) =>
  new SignJWT({ iss: "vault-issuer" })
    .setProtectedHeader({ alg: "HS256" })
    .sign(new TextEncoder().encode(secret));

const call = async (secret: string) =>
  exports.default.fetch(
    new Request("https://gateway.test/vault-jwt", {
      headers: {
        authorization: `Bearer ${await token(secret)}`,
        "CF-Connecting-IP": "203.0.113.250",
      },
    }),
  );

describe("vault-referenced jwt secrets", () => {
  it("accepts a token signed with the resolved secret", async () => {
    const res = await call("gateway-test-jwt-secret");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ upstream: true });
  });

  it("rejects a token signed with the reference string itself", async () => {
    const res = await call("{vault://env/vault-jwt-demo-secret}");
    expect(res.status).toBe(401);
  });
});
