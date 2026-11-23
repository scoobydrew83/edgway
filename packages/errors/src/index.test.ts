import { t } from "@edgway/i18n";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { describe, expect, it } from "vitest";
import {
  ERR,
  errorHandler,
  fail,
  problemResponse,
  problemType,
} from "./index.js";

function app(format?: "problem" | "kong") {
  const a = new Hono();
  a.onError(errorHandler({ format }));
  a.get("/limited", () =>
    fail(ERR.RATE_LIMITED, { extensions: { limit: 30 } }),
  );
  a.get("/challenge", () => {
    const res = problemResponse(ERR.AUTH_KEY_MISSING);
    res.headers.set("www-authenticate", "Key");
    throw new HTTPException(401, { res });
  });
  a.get("/teapot", () => {
    throw new HTTPException(418, { message: "short and stout" });
  });
  a.get("/boom", () => {
    throw new Error("secret internals");
  });
  return a;
}

describe("@edgway/errors", () => {
  it("renders a thrown Edgway error as RFC 9457 problem+json with a stable code", async () => {
    const res = await app().request("/limited");
    expect(res.status).toBe(ERR.RATE_LIMITED.status);
    expect(res.headers.get("content-type")).toContain(
      "application/problem+json",
    );
    expect(await res.json()).toMatchObject({
      type: problemType(ERR.RATE_LIMITED),
      status: 429,
      title: t(ERR.RATE_LIMITED.message),
      code: "EDG-RL-001",
      limit: 30,
    });
  });

  it("maps unexpected errors to EDG-CFG-500 without leaking the message", async () => {
    const res = await app().request("/boom");
    expect(res.status).toBe(500);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe(ERR.INTERNAL.code);
    expect(JSON.stringify(body)).not.toContain("secret internals");
  });

  it("supports Kong's {message} shape in kong mode", async () => {
    const res = await app("kong").request("/limited");
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ message: t(ERR.RATE_LIMITED.message) });
  });

  it("sends an HTTPException's own response as is", async () => {
    const res = await app().request("/challenge");
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe("Key");
    expect(await res.json()).toMatchObject({ code: "EDG-AUTH-002" });
  });

  it("renders a bare HTTPException as a problem with its own status", async () => {
    const res = await app().request("/teapot");
    expect(res.status).toBe(418);
    expect(res.headers.get("content-type")).toContain(
      "application/problem+json",
    );
    expect(await res.json()).toMatchObject({
      status: 418,
      detail: "short and stout",
    });
  });

  it("renders an HTTPException's problem in Kong's shape, keeping its headers", async () => {
    const res = await app("kong").request("/challenge");
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe("Key");
    expect(await res.json()).toEqual({
      message: t(ERR.AUTH_KEY_MISSING.message),
    });
    const teapot = await app("kong").request("/teapot");
    expect(teapot.status).toBe(418);
    expect(await teapot.json()).toHaveProperty("message");
  });

  it("builds a standalone problem Response that accepts extra headers", async () => {
    const res = problemResponse(ERR.AUTH_REQUIRED, { detail: "missing key" });
    res.headers.set("x-test", "1");
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({
      code: "EDG-AUTH-001",
      detail: "missing key",
    });
  });

  it("keeps every error code unique and within the domain ranges", () => {
    const codes = Object.values(ERR).map((e) => e.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) {
      expect(code).toMatch(/^EDG-(AUTH|RL|UP|CFG|PLG|ADM)-\d{3}$/);
    }
  });
});

describe("ERR registry typing", () => {
  it("keeps literal types (as const)", () => {
    const status: 429 = ERR.RATE_LIMITED.status;
    const code: "EDG-RL-001" = ERR.RATE_LIMITED.code;
    expect([status, code]).toEqual([429, "EDG-RL-001"]);
  });
});
