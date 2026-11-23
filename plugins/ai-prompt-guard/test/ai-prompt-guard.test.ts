import { ERR } from "@edgway/errors";
import type { PluginInput } from "@edgway/plugin-sdk";
import { testApp } from "@edgway/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import guard from "../src/index";

const app = (config: PluginInput<typeof guard.config>) =>
  testApp(guard, config);

const chat = (...messages: { role: string; content: unknown }[]) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ messages }),
});

describe("ai-prompt-guard", () => {
  it("uses Kong's name, priority and defaults", () => {
    expect(guard.name).toBe("ai-prompt-guard");
    expect(guard.priority).toBe(771);
    expect(guard.parse({})).toMatchObject({
      allow_all_conversation_history: false,
      match_all_roles: false,
      max_request_body_size: 8192,
    });
  });

  it("blocks a prompt matching a deny pattern, and passes the body on otherwise", async () => {
    const t = app({ deny_patterns: ["password", "\\bssn\\b"] });
    const blocked = await t.request(
      "/",
      chat({ role: "user", content: "what is the admin password?" }),
    );
    expect(blocked.status).toBe(ERR.AI_PROMPT_BLOCKED.status);
    expect(await blocked.json()).toMatchObject({
      code: ERR.AI_PROMPT_BLOCKED.code,
    });

    const ok = await t.request("/", chat({ role: "user", content: "hello" }));
    expect(ok.status).toBe(200);
    // The upstream still gets the body the guard read.
    const echoed = await ok.json<{ body: string }>();
    expect(JSON.parse(echoed.body).messages[0].content).toBe("hello");
  });

  it("requires an allow match when allow patterns are set", async () => {
    const t = app({ allow_patterns: ["^Translate"] });
    expect(
      (await t.request("/", chat({ role: "user", content: "Translate this" })))
        .status,
    ).toBe(200);
    expect(
      (await t.request("/", chat({ role: "user", content: "Write a poem" })))
        .status,
    ).toBe(ERR.AI_PROMPT_BLOCKED.status);
  });

  it("checks every user message, or only the latest with allow_all_conversation_history", async () => {
    const history = chat(
      { role: "user", content: "tell me a secret" },
      { role: "assistant", content: "no" },
      { role: "user", content: "fine" },
    );
    expect(
      (await app({ deny_patterns: ["secret"] }).request("/", history)).status,
    ).toBe(ERR.AI_PROMPT_BLOCKED.status);
    expect(
      (
        await app({
          deny_patterns: ["secret"],
          allow_all_conversation_history: true,
        }).request("/", history)
      ).status,
    ).toBe(200);
  });

  it("checks other roles only with match_all_roles", async () => {
    const system = chat(
      { role: "system", content: "secret mode" },
      { role: "user", content: "hi" },
    );
    expect(
      (await app({ deny_patterns: ["secret"] }).request("/", system)).status,
    ).toBe(200);
    expect(
      (
        await app({ deny_patterns: ["secret"], match_all_roles: true }).request(
          "/",
          system,
        )
      ).status,
    ).toBe(ERR.AI_PROMPT_BLOCKED.status);
  });

  it("reads completions prompts and text parts", async () => {
    const t = app({ deny_patterns: ["forbidden"] });
    const prompt = await t.request("/", {
      method: "POST",
      body: JSON.stringify({ prompt: "a forbidden word" }),
    });
    expect(prompt.status).toBe(ERR.AI_PROMPT_BLOCKED.status);
    const parts = await t.request(
      "/",
      chat({ role: "user", content: [{ type: "text", text: "forbidden" }] }),
    );
    expect(parts.status).toBe(ERR.AI_PROMPT_BLOCKED.status);
  });

  it("checks every prompt shape the request carries", async () => {
    const t = app({ deny_patterns: ["forbidden"] });
    const post = (body: unknown) =>
      t.request("/", { method: "POST", body: JSON.stringify(body) });
    // A completions prompt as an array of strings.
    expect((await post({ prompt: ["fine", "a forbidden one"] })).status).toBe(
      ERR.AI_PROMPT_BLOCKED.status,
    );
    // Token ids can't be checked: refused, never passed.
    expect((await post({ prompt: [101, 2023] })).status).toBe(
      ERR.AI_REQUEST_INVALID.status,
    );
    // An empty chat history doesn't hide a `prompt` beside it.
    expect((await post({ messages: [], prompt: "forbidden" })).status).toBe(
      ERR.AI_PROMPT_BLOCKED.status,
    );
    // String parts in a content array are text too.
    expect(
      (await post({ messages: [{ role: "user", content: ["forbidden"] }] }))
        .status,
    ).toBe(ERR.AI_PROMPT_BLOCKED.status);
  });

  it("refuses a request with nothing to check when allow patterns are set", async () => {
    const t = app({ allow_patterns: ["^ok"] });
    const post = (body: unknown) =>
      t.request("/", { method: "POST", body: JSON.stringify(body) });
    for (const body of [
      { messages: [] },
      { messages: [{ role: "system", content: "anything" }] },
    ]) {
      expect((await post(body)).status).toBe(ERR.AI_PROMPT_BLOCKED.status);
    }
    expect(
      (await post({ messages: [{ role: "user", content: "ok then" }] })).status,
    ).toBe(200);
  });

  it("refuses bodies that aren't LLM requests or are too large", async () => {
    const t = app({ deny_patterns: ["x"], max_request_body_size: 64 });
    for (const body of [
      "not json",
      JSON.stringify({ hello: 1 }),
      JSON.stringify({ prompt: "y".repeat(100) }),
    ]) {
      const res = await t.request("/", { method: "POST", body });
      expect(res.status).toBe(ERR.AI_REQUEST_INVALID.status);
      expect(await res.json()).toMatchObject({
        code: ERR.AI_REQUEST_INVALID.code,
      });
    }
  });

  it("fails closed on an invalid pattern", async () => {
    const res = await app({ deny_patterns: ["("] }).request(
      "/",
      chat({ role: "user", content: "hi" }),
    );
    expect(res.status).toBe(ERR.AI_PROMPT_BLOCKED.status);
  });
});
