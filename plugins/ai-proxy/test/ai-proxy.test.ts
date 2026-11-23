import { AI, HEADER, PLUGIN_RUNNER } from "@edgway/constants";
import type { PluginInstance, RouteMatch } from "@edgway/core";
import { ERR } from "@edgway/errors";
import type { PluginInput } from "@edgway/plugin-sdk";
import { testApp } from "@edgway/plugin-sdk/testing";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import proxy, { setAiTransport, setWorkersAi } from "../src/index";

/** A Workers AI binding that records the model it was asked for. */
function fakeAi() {
  const models: string[] = [];
  const binding = {
    run: async (
      model: string,
      inputs: { messages?: { content: string }[]; stream?: boolean },
    ) => {
      models.push(model);
      const prompt = inputs.messages?.at(-1)?.content ?? "";
      if (inputs.stream) {
        const encoder = new TextEncoder();
        return new ReadableStream({
          start(controller) {
            controller.enqueue(
              encoder.encode(`data: {"response":"streamed ${prompt}"}\n\n`),
            );
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          },
        });
      }
      return {
        response: `workers:${prompt}`,
        usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
      };
    },
  };
  return { binding: binding as unknown as Ai, models };
}

/** The gateway's part: the provider transport, and the AI binding when it has one. */
const gateway = (binding?: Ai, readTimeout?: number): PluginInstance => ({
  id: "gateway",
  name: "gateway",
  priority: Number.MAX_SAFE_INTEGER,
  scope: {},
  handlers: {
    access: async (c, next) => {
      setAiTransport(c, globalThis.fetch);
      if (binding) setWorkersAi(c, binding);
      if (readTimeout !== undefined) {
        // The router's match: the snapshot's service, with Kong's read_timeout.
        c.set("edgwayRoute", {
          route: { id: "r" },
          service: { id: "s", host: "llm.test", read_timeout: readTimeout },
          upstreamPath: "/",
        } as RouteMatch);
      }
      await next();
    },
  },
});

const app = (
  config: PluginInput<typeof proxy.config>,
  binding?: Ai,
  readTimeout?: number,
) =>
  testApp(proxy, config, {
    plugins: [gateway(binding, readTimeout)],
  });

const chat = (content: string, extra: Record<string, unknown> = {}) => ({
  method: "POST",
  body: JSON.stringify({ messages: [{ role: "user", content }], ...extra }),
});

const OPENAI = {
  route_type: "llm/v1/chat" as const,
  model: {
    provider: "openai" as const,
    name: "gpt-4o-mini",
    options: { max_tokens: 256 },
  },
  auth: { header_name: "Authorization", header_value: "Bearer sk-test" },
};

describe("ai-proxy", () => {
  it("uses Kong's name and priority, and never calls the route's upstream", async () => {
    expect(proxy.name).toBe("ai-proxy");
    expect(proxy.priority).toBe(770);
    const t = app(OPENAI);
    await t.request("/", chat("hi"));
    expect(t.upstreamCalls).toHaveLength(0);
  });

  it("passes OpenAI requests through with the model, options and auth applied", async () => {
    const res = await app(OPENAI).request(
      "/",
      chat("hi", { model: "client-choice" }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get(HEADER.llmModel)).toBe("openai/gpt-4o-mini");
    const body = await res.json<{
      url: string;
      authorization: string;
      body: Record<string, unknown>;
    }>();
    expect(body.url).toBe(AI.openaiUrl.chat);
    expect(body.authorization).toBe("Bearer sk-test");
    expect(body.body).toMatchObject({ model: "gpt-4o-mini", max_tokens: 256 });
  });

  it("refuses a body over max_request_body_size, however it's sent", async () => {
    const t = app({ ...OPENAI, max_request_body_size: 64 });
    const big = chat("x".repeat(200));
    // With a Content-Length.
    const sized = await t.request("/", big);
    expect(sized.status).toBe(ERR.AI_REQUEST_INVALID.status);
    // Streamed without one: counted as it's read.
    const streamed = await t.request("/", {
      method: "POST",
      body: new Blob([big.body]).stream(),
      duplex: "half",
    } as RequestInit);
    expect(streamed.status).toBe(ERR.AI_REQUEST_INVALID.status);
    // The default (Kong's 8192) still takes an ordinary chat.
    expect((await app(OPENAI).request("/", chat("hi"))).status).toBe(200);
  });

  it("uses upstream_url, query auth and the completions endpoint", async () => {
    const res = await app({
      route_type: "llm/v1/completions",
      model: { provider: "openai", name: "davinci" },
      auth: { param_name: "key", param_value: "k1", param_location: "query" },
    }).request("/", { method: "POST", body: JSON.stringify({ prompt: "hi" }) });
    expect((await res.json<{ url: string }>()).url).toBe(
      `${AI.openaiUrl.completions}?key=k1`,
    );
  });

  it("keeps the client's own credentials with allow_override", async () => {
    type Echo = { url: string; authorization: string; body: { key?: string } };
    const asClient = (init: RequestInit) => ({
      ...init,
      headers: { [HEADER.authorization]: "Bearer client" },
    });
    const kept = await app({
      ...OPENAI,
      auth: { ...OPENAI.auth, allow_override: true },
    }).request("/", asClient(chat("hi")));
    expect((await kept.json<Echo>()).authorization).toBe("Bearer client");
    // Without allow_override, the configured key replaces the client's.
    const replaced = await app(OPENAI).request("/", asClient(chat("hi")));
    expect((await replaced.json<Echo>()).authorization).toBe("Bearer sk-test");
    // Without a client key, the configured one is used.
    const configured = await app({
      ...OPENAI,
      auth: { ...OPENAI.auth, allow_override: true },
    }).request("/", chat("hi"));
    expect((await configured.json<Echo>()).authorization).toBe(
      "Bearer sk-test",
    );

    const query = await app({
      ...OPENAI,
      auth: {
        param_name: "key",
        param_value: "k1",
        param_location: "query",
        allow_override: true,
      },
    }).request("/?key=mine", chat("hi"));
    expect((await query.json<Echo>()).url).toBe(
      `${AI.openaiUrl.chat}?key=mine`,
    );
    const body = await app({
      ...OPENAI,
      auth: {
        param_name: "key",
        param_value: "k1",
        param_location: "body",
        allow_override: true,
      },
    }).request("/", chat("hi", { key: "mine" }));
    expect((await body.json<Echo>()).body.key).toBe("mine");

    const anthropic = await app({
      route_type: "llm/v1/chat",
      model: { provider: "anthropic", name: "claude-test" },
      auth: {
        header_name: HEADER.apiKey,
        header_value: "configured",
        allow_override: true,
      },
    }).request("/", {
      ...chat("hi"),
      headers: { [HEADER.apiKey]: "client-key" },
    });
    expect(
      (await anthropic.json<{ choices: { message: { content: string } }[] }>())
        .choices[0]?.message.content,
    ).toBe("anthropic:client-key:hi");
  });

  it("streams pass-through answers untouched, and applies response_streaming", async () => {
    const streamed = await app(OPENAI).request(
      "/",
      chat("hi", { stream: true }),
    );
    expect(await streamed.text()).toContain('"passthrough":true');

    const denied = await app({ ...OPENAI, response_streaming: "deny" }).request(
      "/",
      chat("hi", { stream: true }),
    );
    expect(denied.status).toBe(ERR.AI_STREAMING_DENIED.status);

    const forced = await app({
      ...OPENAI,
      response_streaming: "always",
    }).request("/", chat("hi"));
    expect(await forced.text()).toContain('"passthrough":true');
  });

  it("translates Anthropic through the AI SDK into OpenAI's format", async () => {
    const res = await app({
      route_type: "llm/v1/chat",
      model: {
        provider: "anthropic",
        name: "claude-test",
        options: { max_tokens: 100 },
      },
      auth: { header_name: "x-api-key", header_value: "ak-test" },
    }).request("/", chat("hello"));
    expect(res.status).toBe(200);
    expect(res.headers.get(HEADER.llmModel)).toBe("anthropic/claude-test");
    expect(await res.json()).toMatchObject({
      object: "chat.completion",
      model: "claude-test",
      choices: [
        { message: { role: "assistant", content: "anthropic:ak-test:hello" } },
      ],
      usage: { prompt_tokens: 5, completion_tokens: 6, total_tokens: 11 },
    });
  });

  it("selects Workers AI with the workers-ai: upstream_url", async () => {
    const ai = fakeAi();
    const res = await app(
      {
        route_type: "llm/v1/chat",
        model: {
          provider: "openai",
          name: "@cf/test/model",
          options: { upstream_url: AI.workersAiScheme },
        },
      },
      ai.binding,
    ).request("/", chat("hey"));
    expect(res.headers.get(HEADER.llmModel)).toBe(
      `${AI.workersAiProvider}/@cf/test/model`,
    );
    expect(await res.json()).toMatchObject({
      choices: [{ message: { content: "workers:hey" } }],
      usage: { total_tokens: 3 },
    });
    expect(ai.models).toEqual(["@cf/test/model"]);
  });

  it("streams Workers AI answers as OpenAI server-sent events", async () => {
    const ai = fakeAi();
    const res = await app(
      {
        route_type: "llm/v1/chat",
        model: {
          provider: "openai",
          name: "@cf/test/model",
          options: { upstream_url: AI.workersAiScheme },
        },
      },
      ai.binding,
    ).request("/", chat("hey", { stream: true }));
    const text = await res.text();
    expect(text).toContain('"delta":{"content":"streamed hey"}');
    expect(text.trim().endsWith("data: [DONE]")).toBe(true);
  });

  it("falls back to Workers AI when the provider fails, if the gateway has the binding", async () => {
    const ai = fakeAi();
    const failedOver = await app(OPENAI, ai.binding).request(
      "/",
      chat("please fail 503"),
    );
    expect(failedOver.status).toBe(200);
    expect(failedOver.headers.get(HEADER.llmModel)).toBe(
      `${AI.workersAiProvider}/${AI.fallbackModel}`,
    );
    expect(ai.models).toEqual([AI.fallbackModel]);

    const anthropic = await app(
      {
        route_type: "llm/v1/chat",
        model: { provider: "anthropic", name: "claude-test" },
      },
      ai.binding,
    ).request("/", chat("please fail 503"));
    expect(anthropic.status).toBe(200);
    expect(anthropic.headers.get(HEADER.llmModel)).toBe(
      `${AI.workersAiProvider}/${AI.fallbackModel}`,
    );

    // Without the binding, the provider's failure is the answer.
    expect(
      (await app(OPENAI).request("/", chat("please fail 503"))).status,
    ).toBe(503);
  });

  it("answers 502 when Workers AI fails, directly or as the fallback", async () => {
    const broken = {
      run: async () => {
        throw new Error("binding down");
      },
    } as unknown as Ai;
    const direct = await app(
      {
        route_type: "llm/v1/chat",
        model: {
          provider: "openai",
          options: { upstream_url: AI.workersAiScheme },
        },
      },
      broken,
    ).request("/", chat("hi"));
    expect(direct.status).toBe(ERR.AI_PROVIDER_FAILED.status);
    expect(await direct.json()).toMatchObject({
      code: ERR.AI_PROVIDER_FAILED.code,
    });
    const fallback = await app(OPENAI, broken).request(
      "/",
      chat("please fail 503"),
    );
    expect(fallback.status).toBe(ERR.AI_PROVIDER_FAILED.status);
  });

  it("falls back when the provider doesn't answer within the service's read_timeout", async () => {
    const ai = fakeAi();
    const openai = await app(OPENAI, ai.binding, 50).request(
      "/",
      chat("slow 1000"),
    );
    expect(openai.status).toBe(200);
    expect(openai.headers.get(HEADER.llmModel)).toBe(
      `${AI.workersAiProvider}/${AI.fallbackModel}`,
    );
    const anthropic = await app(
      {
        route_type: "llm/v1/chat",
        model: { provider: "anthropic", name: "claude-test" },
      },
      ai.binding,
      50,
    ).request("/", chat("slow 1000"));
    expect(anthropic.headers.get(HEADER.llmModel)).toBe(
      `${AI.workersAiProvider}/${AI.fallbackModel}`,
    );
    expect(ai.models).toEqual([AI.fallbackModel, AI.fallbackModel]);
    // Without the binding: 502. Within the deadline, the provider answers.
    expect(
      (await app(OPENAI, undefined, 50).request("/", chat("slow 1000"))).status,
    ).toBe(ERR.AI_PROVIDER_FAILED.status);
    const inTime = await app(OPENAI, ai.binding, 5000).request(
      "/",
      chat("slow 10"),
    );
    expect(inTime.headers.get(HEADER.llmModel)).toBe("openai/gpt-4o-mini");
  });

  it("refuses requests it can't serve", async () => {
    const t = app({ ...OPENAI, max_request_body_size: 32 });
    expect(
      (await t.request("/", { method: "POST", body: "not json" })).status,
    ).toBe(ERR.AI_REQUEST_INVALID.status);
    expect((await t.request("/", chat("x".repeat(64)))).status).toBe(
      ERR.AI_REQUEST_INVALID.status,
    );
    const cohere = await app({
      route_type: "llm/v1/chat",
      model: { provider: "cohere", name: "c" },
    }).request("/", chat("hi"));
    expect(cohere.status).toBe(ERR.AI_REQUEST_INVALID.status);
  });
});

describe("the runner instance", () => {
  it("outlasts the provider deadline and always fails closed", () => {
    const instance = proxy.instance({
      id: "p1",
      config: { route_type: "llm/v1/chat", model: { provider: "openai" } },
      on_error: "fail-open",
    });
    expect(instance.timeoutMs).toBe(AI.runnerTimeoutMs);
    expect(instance.timeoutMs).toBeGreaterThan(AI.timeoutMs);
    expect(instance.on_error).toBe("fail-closed");
    expect(
      proxy.instance({
        id: "p2",
        config: {
          route_type: "llm/v1/chat",
          model: { provider: "openai" },
        },
        timeoutMs: 90_000,
      }).timeoutMs,
    ).toBe(90_000);
  });
});

describe("plain Hono middleware", () => {
  it("waits past the runner's default timeout and never falls through", async () => {
    const slow = new Hono();
    slow.use(async (c, next) => {
      setAiTransport(c, async () => {
        await scheduler.wait(PLUGIN_RUNNER.timeoutMs + 500);
        return Response.json({
          choices: [{ message: { role: "assistant", content: "late" } }],
        });
      });
      await next();
    });
    const config = {
      route_type: "llm/v1/chat",
      model: { provider: "openai", name: "gpt-test" },
    };
    slow.post("/chat", proxy.middleware(config), (c) =>
      c.text("fell through", 299 as never),
    );
    const res = await slow.request("/chat", {
      method: "POST",
      body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("late");

    // A failure answers itself (no transport: 502), never the next handler.
    const broken = new Hono();
    broken.post("/chat", proxy.middleware(config), (c) =>
      c.text("fell through"),
    );
    const failed = await broken.request("/chat", {
      method: "POST",
      body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
    });
    expect(failed.status).toBe(ERR.AI_PROVIDER_FAILED.status);
    expect(await failed.text()).not.toContain("fell through");
  }, 15_000);
});
