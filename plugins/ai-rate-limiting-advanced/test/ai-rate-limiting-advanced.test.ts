import { AI, HEADER } from "@edgway/constants";
import type { PluginInstance } from "@edgway/core";
import { ERR, STATUS } from "@edgway/errors";
import type { PluginInput } from "@edgway/plugin-sdk";
import { testApp } from "@edgway/plugin-sdk/testing";
import type { Handler } from "hono";
import { describe, expect, it } from "vitest";
import limiter, {
  type AiTokenCounters,
  setAiTokenCounters,
} from "../src/index";

/** In-memory counters, one window per key (what a Durable Object keeps). */
function memoryCounters(): AiTokenCounters & { added: number[] } {
  const counts = new Map<string, number>();
  const added: number[] = [];
  return {
    added,
    get: async (key) => ({ used: counts.get(key) ?? 0, resetSeconds: 42 }),
    add: async (key, _window, tokens) => {
      added.push(tokens);
      counts.set(key, (counts.get(key) ?? 0) + tokens);
    },
  };
}

const withCounters = (counters: AiTokenCounters): PluginInstance => ({
  id: "counters",
  name: "counters",
  priority: Number.MAX_SAFE_INTEGER,
  scope: {},
  handlers: {
    access: async (c, next) => {
      setAiTokenCounters(c, counters);
      await next();
    },
  },
});

/** What ai-proxy answers: OpenAI's shape, its model in x-edgway-llm-model. */
const llm =
  (provider = "openai", stream = false): Handler =>
  (c) => {
    const usage = {
      prompt_tokens: 10,
      completion_tokens: 30,
      total_tokens: 40,
    };
    const headers = { [HEADER.llmModel]: `${provider}/m` };
    return stream
      ? c.body(
          `data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: {"choices":[],"usage":${JSON.stringify(usage)}}\n\ndata: [DONE]\n\n`,
          STATUS.ok,
          headers,
        )
      : c.json({ choices: [], usage }, STATUS.ok, headers);
  };

const app = (
  config: PluginInput<typeof limiter.config>,
  counters: AiTokenCounters,
  upstream: Handler = llm(),
) => testApp(limiter, config, { plugins: [withCounters(counters)], upstream });

const OPENAI_100 = {
  llm_providers: [{ name: "openai" as const, limit: 100, window_size: 60 }],
};
const client = (ip: string) => ({ headers: { [HEADER.clientIp]: ip } });

describe("ai-rate-limiting-advanced", () => {
  it("uses Kong's name, priority and defaults", () => {
    expect(limiter.name).toBe("ai-rate-limiting-advanced");
    expect(limiter.priority).toBe(905);
    expect(limiter.parse({ llm_providers: [] })).toMatchObject({
      tokens_count_strategy: "total_tokens",
      identifier: "consumer",
      error_code: 429,
    });
  });

  it("counts the answer's total tokens and refuses once the limit is used up", async () => {
    const counters = memoryCounters();
    const t = app(OPENAI_100, counters);
    for (let i = 0; i < 3; i++) {
      const res = await t.request("/", client("203.0.113.1"));
      await res.text();
      expect(res.status).toBe(200);
    }
    expect(counters.added).toEqual([40, 40, 40]);
    const denied = await t.request("/", client("203.0.113.1"));
    expect(denied.status).toBe(ERR.AI_RATE_LIMITED.status);
    expect(denied.headers.get(HEADER.retryAfter)).toBe("42");
    expect(denied.headers.get(`${AI.rateLimitRemaining}-60-openai`)).toBe("0");
    const body = await denied.json<{ code: string; detail: string }>();
    expect(body.code).toBe(ERR.AI_RATE_LIMITED.code);
    expect(body.detail).toContain("openai");
    // Another client has its own counter.
    expect((await t.request("/", client("203.0.113.2"))).status).toBe(200);
  });

  it("reads usage from server-sent events and counts by tokens_count_strategy", async () => {
    const counters = memoryCounters();
    const res = await app(
      { ...OPENAI_100, tokens_count_strategy: "completion_tokens" },
      counters,
      llm("openai", true),
    ).request("/", client("203.0.113.3"));
    expect(await res.text()).toContain("[DONE]");
    expect(counters.added).toEqual([30]);
  });

  it("doesn't count answers from a provider it has no limit for", async () => {
    const counters = memoryCounters();
    const res = await app(
      OPENAI_100,
      counters,
      llm(AI.workersAiProvider),
    ).request("/", client("203.0.113.4"));
    await res.text();
    expect(counters.added).toEqual([]);
  });

  it("counts requests for requestPrompt; disable_penalty spares denied ones", async () => {
    const counters = memoryCounters();
    const t = app(
      { llm_providers: [{ name: "requestPrompt", limit: 2, window_size: 60 }] },
      counters,
    );
    const statuses = [];
    for (let i = 0; i < 3; i++)
      statuses.push((await t.request("/", client("198.51.100.1"))).status);
    expect(statuses).toEqual([200, 200, 429]);
    expect(counters.added).toEqual([1, 1, 1]);

    const lenient = memoryCounters();
    const t2 = app(
      {
        llm_providers: [{ name: "requestPrompt", limit: 1, window_size: 60 }],
        disable_penalty: true,
      },
      lenient,
    );
    expect((await t2.request("/", client("198.51.100.2"))).status).toBe(200);
    expect((await t2.request("/", client("198.51.100.2"))).status).toBe(429);
    expect(lenient.added).toEqual([1]);
  });

  it("applies error_code, error_hide_providers and hide_client_headers", async () => {
    const counters = memoryCounters();
    const config = {
      llm_providers: [{ name: "openai" as const, limit: 1, window_size: 60 }],
      error_code: 503,
      error_hide_providers: true,
      hide_client_headers: true,
    };
    const t = app(config, counters);
    const ok = await t.request("/", client("192.0.2.1"));
    await ok.text();
    expect(ok.headers.has(`${AI.rateLimitLimit}-60-openai`)).toBe(false);
    const denied = await t.request("/", client("192.0.2.1"));
    expect(denied.status).toBe(503);
    expect(denied.headers.has(`${AI.rateLimitRemaining}-60-openai`)).toBe(
      false,
    );
    expect((await denied.json<{ detail?: string }>()).detail).toBeUndefined();
  });

  it("is a 500 without the gateway's counters", async () => {
    const res = await testApp(limiter, OPENAI_100).request("/");
    expect(res.status).toBe(ERR.INTERNAL.status);
  });
});
