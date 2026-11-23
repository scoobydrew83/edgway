/** the AI plugins in the gateway, against a stand-in OpenAI-format provider. */
import { exports } from "cloudflare:workers";
import { AI, HEADER } from "@edgway/constants";
import { ERR } from "@edgway/errors";
import { describe, expect, it } from "vitest";

type Chat = { choices: { message: { content: string } }[] };

let ip = 0;
/** One chat request; each call is its own client unless `client` is given. */
const chat = (model: string, content: string, client = `203.0.113.${++ip}`) =>
  exports.default.fetch(
    new Request("https://gateway.test/ai", {
      method: "POST",
      headers: {
        "CF-Connecting-IP": client,
        [HEADER.contentType]: "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content }],
      }),
    }),
  );

describe("an AI route: ai-prompt-guard, ai-rate-limiting-advanced, ai-proxy", () => {
  it("answers through the provider with the configured auth", async () => {
    const res = await chat("gpt-test", "hello");
    expect(res.status).toBe(200);
    expect(res.headers.get(HEADER.llmModel)).toBe("openai/gpt-test");
    const body = await res.json<Chat>();
    // The stand-in echoes the Authorization ai-proxy sent.
    expect(body.choices[0]?.message.content).toBe("Bearer llm-key");
  });

  it("blocks a denied prompt before the provider", async () => {
    const res = await chat("gpt-test", "something forbidden");
    expect(res.status).toBe(ERR.AI_PROMPT_BLOCKED.status);
    expect(await res.json()).toMatchObject({
      code: ERR.AI_PROMPT_BLOCKED.code,
    });
  });

  it("limits a client by the tokens its answers used", async () => {
    const client = "203.0.113.200";
    // 20 tokens each: 0 and 20 are under the limit of 30, 40 is not.
    for (let i = 0; i < 2; i++) {
      const res = await chat("gpt-test", "hello", client);
      expect(res.status).toBe(200);
      await res.text();
    }
    const limited = await chat("gpt-test", "hello", client);
    expect(limited.status).toBe(ERR.AI_RATE_LIMITED.status);
    expect(limited.headers.get(HEADER.retryAfter)).not.toBeNull();
    expect(limited.headers.get(`${AI.rateLimitRemaining}-60-openai`)).toBe("0");
    // Another client is unaffected.
    expect((await chat("gpt-test", "hello")).status).toBe(200);
  });

  it("waits for a provider answer longer than the runner's default timeout", async () => {
    const started = Date.now();
    const res = await chat("slow", "hello");
    expect(res.status).toBe(200);
    expect(Date.now() - started).toBeGreaterThanOrEqual(5000);
  }, 15_000);

  // The test AI binding can't run (no remote session), so the Workers AI
  // fallback fails as well: ai-proxy answers 502 itself.
  it("answers a provider that fails itself, never through the service host", async () => {
    const res = await chat("fail", "hello");
    expect(res.status).toBe(ERR.AI_PROVIDER_FAILED.status);
    const body = await res.json<Record<string, unknown>>();
    expect(body).toMatchObject({ code: ERR.AI_PROVIDER_FAILED.code });
    expect(body).not.toHaveProperty("upstream");
  });
});
