import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import {
  errorsAuthRequired,
  formatBytes,
  formatNumber,
  getLocale,
  i18nMiddleware,
  locales,
  t,
} from "./index.js";

function app() {
  const a = new Hono();
  a.use("*", i18nMiddleware());
  a.get("/", (c) =>
    c.json({
      locale: getLocale(),
      title: t(errorsAuthRequired),
      n: formatNumber(1234.5),
    }),
  );
  a.post("/echo", async (c) => c.text(await c.req.text()));
  a.get("/raw", () => fetch("data:text/plain,raw"));
  return a;
}

describe("@edgway/i18n", () => {
  it("ships en and the x-pseudo locale", () => {
    expect(locales).toEqual(["en", "x-pseudo"]);
  });

  it("uses the base locale without Accept-Language, and outside a request", async () => {
    expect(getLocale()).toBe("en");
    expect(t(errorsAuthRequired)).toBe("Valid API key or JWT required");
    const body = await (await app().request("/")).json();
    expect(body).toEqual({
      locale: "en",
      title: "Valid API key or JWT required",
      n: "1,234.5",
    });
  });

  it("resolves x-pseudo from Accept-Language and sets Vary", async () => {
    const res = await app().request("/", {
      headers: { "accept-language": "x-pseudo" },
    });
    const body = (await res.json()) as Record<string, string>;
    expect(body.locale).toBe("x-pseudo");
    expect(body.title).toMatch(/^\[.+\]$/);
    expect(body.title).not.toBe("Valid API key or JWT required");
    expect(body.n).toBe("1,234.5");
    expect(res.headers.get("vary")).toContain("accept-language");
  });

  it("keeps concurrent requests isolated", async () => {
    const a = app();
    const [en, pseudo] = await Promise.all([
      a.request("/"),
      a.request("/", { headers: { "accept-language": "x-pseudo" } }),
    ]);
    expect(((await en.json()) as { locale: string }).locale).toBe("en");
    expect(((await pseudo.json()) as { locale: string }).locale).toBe(
      "x-pseudo",
    );
  });

  it("never reads the request body (POST bodies reach the handler intact)", async () => {
    const res = await app().request("/echo", {
      method: "POST",
      body: "payload",
    });
    expect(await res.text()).toBe("payload");
  });

  it("adds Vary even to responses with immutable headers", async () => {
    const res = await app().request("/raw");
    expect(await res.text()).toBe("raw");
    expect(res.headers.get("vary")).toContain("accept-language");
  });

  it("formats bytes with Intl units", () => {
    expect(formatBytes(1500)).toBe("1.5 kB");
  });
});
