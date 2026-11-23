/** Smoke test: the generated SDK against the real admin Worker. */
import { env } from "cloudflare:test";
import { HEADER } from "@edgway/constants";
import { importJWK, type JWK, SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import {
  createEdgwayClient,
  createServices,
  getServices,
  listServices,
  pendingChanges,
  zGetServicesResponse,
} from "../src/index";

/** An Access JWT for the test team, as Cloudflare Access would sign it. */
async function accessToken(email: string) {
  const key = await importJWK(JSON.parse(env.TEST_ACCESS_KEY) as JWK, "RS256");
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ email })
    .setProtectedHeader({ alg: "RS256", kid: "test" })
    .setIssuer(`https://${env.ACCESS_TEAM}.cloudflareaccess.com`)
    .setAudience(env.ACCESS_AUD)
    .setIssuedAt(now - 60)
    .setExpirationTime(now + 300)
    .sign(key);
}

const edgway = async (email = "sdk@example.com") =>
  createEdgwayClient({
    adminUrl: "https://admin.test",
    headers: { [HEADER.cfAccessJwtAssertion]: await accessToken(email) },
    fetch: (input, init) => env.ADMIN.fetch(new Request(input, init)),
  });

describe("@edgway/sdk against the admin", () => {
  it("creates, reads and lists entities with typed results", async () => {
    const client = await edgway();
    const created = await createServices({
      client,
      body: { name: "sdk-svc", host: "api.example.com" },
    });
    expect(created.response?.status).toBe(201);
    const id = String(created.data?.id);
    const read = await getServices({ client, path: { id } });
    expect(read.data).toMatchObject({ id, name: "sdk-svc", port: 80 });
    // The zod schemas parse what the API returns.
    expect(zGetServicesResponse.safeParse(read.data).success).toBe(true);
    const list = await listServices({ client });
    expect(list.data?.data.map((s) => s.name)).toContain("sdk-svc");
  });

  it("reads the pending diff before a publish", async () => {
    const pending = await pendingChanges({ client: await edgway() });
    expect(pending.response?.status).toBe(200);
    expect(JSON.stringify(pending.data)).toContain("sdk-svc");
  });

  it("surfaces the admin's errors (no Access identity → 401)", async () => {
    const client = createEdgwayClient({
      adminUrl: "https://admin.test",
      fetch: (input, init) => env.ADMIN.fetch(new Request(input, init)),
    });
    const res = await listServices({ client });
    expect(res.response?.status).toBe(401);
    expect(res.error).toBeTruthy();
  });
});
