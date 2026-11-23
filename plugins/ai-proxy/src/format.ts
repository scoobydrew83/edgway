/**
 * OpenAI's chat and completions formats, which ai-proxy speaks to clients
 * (Kong's `llm/v1/chat` and `llm/v1/completions`): requests mapped to an AI
 * SDK provider model's prompt, and its results mapped back, whole or as
 * server-sent events.
 */
import type { createAnthropic } from "@ai-sdk/anthropic";
import { AI } from "@edgway/constants";
import { uuidv7 } from "uuidv7";

/** An AI SDK provider's language model (the v4 specification every provider here implements). */
export type Model = ReturnType<ReturnType<typeof createAnthropic>>;
type CallOptions = Parameters<Model["doGenerate"]>[0];
export type Prompt = CallOptions["prompt"];
type GenerateResult = Awaited<ReturnType<Model["doGenerate"]>>;
type ModelUsage = GenerateResult["usage"];
type FinishReason = GenerateResult["finishReason"];

export type RouteType = "llm/v1/chat" | "llm/v1/completions";

interface OpenAiMessage {
  role?: string;
  content?: unknown;
}

export interface OpenAiRequest {
  model?: string;
  messages?: OpenAiMessage[];
  prompt?: unknown;
  stream?: boolean;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  [key: string]: unknown;
}

export interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

/** A message's text: a string, or the text parts of an array. */
const textOf = (content: unknown): string =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content
          .map((part) =>
            part && typeof part === "object" && "text" in part
              ? String((part as { text: unknown }).text)
              : "",
          )
          .join("")
      : "";

/** The request's prompt for a provider model; undefined when it has none. */
export function toPrompt(
  route: RouteType,
  body: OpenAiRequest,
): Prompt | undefined {
  const user = (text: string) => ({
    role: "user" as const,
    content: [{ type: "text" as const, text }],
  });
  if (route === "llm/v1/completions") {
    return body.prompt === undefined ? undefined : [user(textOf(body.prompt))];
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return undefined;
  }
  const prompt: Prompt = [];
  for (const m of body.messages) {
    const text = textOf(m.content);
    if (m.role === "system") prompt.push({ role: "system", content: text });
    else if (m.role === "user") prompt.push(user(text));
    else if (m.role === "assistant") {
      prompt.push({ role: "assistant", content: [{ type: "text", text }] });
    } else return undefined;
  }
  return prompt;
}

/** A provider model's usage in OpenAI's shape. */
export function toUsage(usage: ModelUsage | undefined): Usage {
  const prompt = usage?.inputTokens.total ?? 0;
  const completion = usage?.outputTokens.total ?? 0;
  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: prompt + completion,
  };
}

/** OpenAI's finish_reason for a provider model's finish reason. */
export function toFinishReason(reason: FinishReason | undefined): string {
  switch (reason?.unified) {
    case "length":
      return "length";
    case "content-filter":
      return "content_filter";
    case "tool-calls":
      return "tool_calls";
    default:
      return "stop";
  }
}

const now = () => Math.floor(Date.now() / 1000);

/** A whole answer in OpenAI's shape for the route. */
export function toResponseBody(
  route: RouteType,
  model: string,
  text: string,
  finishReason: string,
  usage: Usage,
) {
  const id = `chatcmpl-${uuidv7()}`;
  return route === "llm/v1/completions"
    ? {
        id,
        object: "text_completion",
        created: now(),
        model,
        choices: [{ index: 0, text, finish_reason: finishReason }],
        usage,
      }
    : {
        id,
        object: "chat.completion",
        created: now(),
        model,
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: text },
            finish_reason: finishReason,
          },
        ],
        usage,
      };
}

/**
 * Text deltas as OpenAI's server-sent events: one chunk per delta, a last
 * chunk with the finish reason and usage, then `[DONE]`.
 */
export function toEventStream(
  route: RouteType,
  model: string,
  deltas: AsyncIterable<string>,
  finish: () => Promise<{ finishReason: string; usage: Usage }>,
): ReadableStream<Uint8Array> {
  const id = `chatcmpl-${uuidv7()}`;
  const created = now();
  const encoder = new TextEncoder();
  const event = (choice: Record<string, unknown>, extra = {}) =>
    encoder.encode(
      `data: ${JSON.stringify({
        id,
        object:
          route === "llm/v1/completions"
            ? "text_completion"
            : "chat.completion.chunk",
        created,
        model,
        choices: [{ index: 0, ...choice }],
        ...extra,
      })}\n\n`,
    );
  // Pulled: the client's pace drives reading from the provider.
  const iterator = deltas[Symbol.asyncIterator]();
  return new ReadableStream({
    async pull(controller) {
      const next = await iterator.next();
      if (!next.done) {
        controller.enqueue(
          event(
            route === "llm/v1/completions"
              ? { text: next.value, finish_reason: null }
              : { delta: { content: next.value }, finish_reason: null },
          ),
        );
        return;
      }
      const { finishReason, usage } = await finish();
      controller.enqueue(
        event(
          route === "llm/v1/completions"
            ? { text: "", finish_reason: finishReason }
            : { delta: {}, finish_reason: finishReason },
          { usage },
        ),
      );
      controller.enqueue(encoder.encode(AI.sseDone));
      controller.close();
    },
    async cancel(reason) {
      await iterator.return?.(reason);
    },
  });
}
