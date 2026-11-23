import type { PluginInput } from "@edgway/plugin-sdk";
import { testApp } from "@edgway/plugin-sdk/testing";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import sizeLimit from "../src/index";

/** A fixed-size body, as a client sends it (with Content-Length). */
const post = (body: string): RequestInit => ({
  method: "POST",
  body,
  headers: {
    "content-length": String(new TextEncoder().encode(body).byteLength),
  },
});

const app = (config: PluginInput<typeof sizeLimit.config> = {}) =>
  testApp(sizeLimit, config);

/** A body sent chunked: no Content-Length. */
function chunked(size: number, chunk = 256): RequestInit {
  let sent = 0;
  return {
    method: "POST",
    body: new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= size) return controller.close();
        const n = Math.min(chunk, size - sent);
        sent += n;
        controller.enqueue(new Uint8Array(n).fill(97));
      },
    }),
    duplex: "half",
  } as RequestInit;
}

describe("request-size-limiting", () => {
  it("uses Kong's name, priority and defaults", () => {
    expect(sizeLimit.name).toBe("request-size-limiting");
    expect(sizeLimit.priority).toBe(951);
    expect(sizeLimit.parse({})).toMatchObject({
      allowed_payload_size: 128,
      size_unit: "megabytes",
      require_content_length: false,
    });
  });

  it("rejects an oversized Content-Length before reading the body", async () => {
    const t = app({ allowed_payload_size: 10, size_unit: "bytes" });
    const res = await t.request("/", post("x".repeat(11)));
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({
      code: "EDG-PLG-001",
      title: "Request size limit exceeded",
    });
    expect(t.upstreamCalls).toHaveLength(0);
  });

  it("lets a request within the limit through", async () => {
    const t = app({ allowed_payload_size: 10, size_unit: "bytes" });
    const res = await t.request("/", post("x".repeat(10)));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ body: "x".repeat(10) });
  });

  it("converts kilobytes and megabytes as Kong does (binary)", async () => {
    const kb = app({ allowed_payload_size: 1, size_unit: "kilobytes" });
    expect((await kb.request("/", post("x".repeat(1024)))).status).toBe(200);
    expect((await kb.request("/", post("x".repeat(1025)))).status).toBe(413);
    const mb = app({ allowed_payload_size: 1 });
    const big = "x".repeat(1_048_577);
    expect((await mb.request("/", post(big))).status).toBe(413);
  });

  it("limits a chunked body by streaming it, never buffering", async () => {
    const t = app({ allowed_payload_size: 1, size_unit: "kilobytes" });
    const ok = await t.request("/", chunked(1000));
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { body: string }).body).toHaveLength(1000);
    const res = await t.request("/", chunked(5000));
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ code: "EDG-PLG-001" });
  });

  it("answers 413 even when the upstream fails reading the cut-off body", async () => {
    // Stands in for the gateway's fetch, which rejects with its own error.
    const t = testApp(
      sizeLimit,
      { allowed_payload_size: 1, size_unit: "kilobytes" },
      {
        upstream: async (c) => {
          const reader = c.req.raw.body?.getReader();
          try {
            for (;;) if ((await reader?.read())?.done) break;
          } catch {
            throw new Error("upstream connection reset");
          }
          return c.text("unreachable");
        },
      },
    );
    const res = await t.request("/", chunked(5000));
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ code: "EDG-PLG-001" });
  });

  it("requires Content-Length with require_content_length", async () => {
    const t = app({ require_content_length: true });
    const res = await t.request("/", chunked(10));
    expect(res.status).toBe(411);
    expect(await res.json()).toMatchObject({
      code: "EDG-PLG-002",
      title: "A valid Content-Length header is required",
    });
    expect((await t.request("/", post("x"))).status).toBe(200);
  });

  it("lets bodiless requests through", async () => {
    expect(
      (await app({ allowed_payload_size: 1, size_unit: "bytes" }).request("/"))
        .status,
    ).toBe(200);
  });

  it("is also plain Hono middleware", async () => {
    const plain = new Hono();
    plain.use(
      sizeLimit.middleware({ allowed_payload_size: 4, size_unit: "bytes" }),
    );
    plain.post("/", async (c) => c.text(await c.req.text()));
    expect(await (await plain.request("/", post("abcd"))).text()).toBe("abcd");
    expect((await plain.request("/", post("abcde"))).status).toBe(413);
  });
});
