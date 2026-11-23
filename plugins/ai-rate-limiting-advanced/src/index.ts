/**
 * Kong's ai-rate-limiting-advanced (priority 905; Kong's name, Drew
 * 2026-09-29): token limits per LLM provider and window, counted from the
 * `usage` in the provider's answer (OpenAI's shape, which ai-proxy always
 * answers in). The provider is the one ai-proxy names in `x-edgway-llm-model`.
 *
 * Before the request, every configured provider's counter for this client is
 * checked; an exhausted one answers `error_code` (429) with Retry-After.
 * Afterwards the answer's tokens (`tokens_count_strategy`) are added to the
 * serving provider's counter. `requestPrompt` counts requests instead.
 * Counters come from the gateway (`setAiTokenCounters`), like rate-limiting's.
 */
import { AI, HEADER } from "@edgway/constants";
import { getConsumer, getRoute, sha256Hex } from "@edgway/core";
import { ERR, problemResponse } from "@edgway/errors";
import { definePlugin, type PluginConfig } from "@edgway/plugin-sdk";
import { kongSchema } from "@edgway/schema";
import type { Context } from "hono";

/** A token counter per key and window (the gateway supplies Durable Object ones). */
export interface AiTokenCounters {
  /** Tokens counted in the current window, and seconds until it resets. */
  get(
    key: string,
    windowSeconds: number,
  ): Promise<{ used: number; resetSeconds: number }>;
  /** Add tokens to the current window. */
  add(key: string, windowSeconds: number, tokens: number): Promise<void>;
}

declare module "hono" {
  interface ContextVariableMap {
    edgwayAiTokenCounters?: AiTokenCounters;
    /** This request's counter key prefix (hashed identifier, scoped to route and service). */
    edgwayAiTokenKey?: string;
  }
}

/** Called by the gateway before the plugins run. */
export function setAiTokenCounters(
  c: Context,
  counters: AiTokenCounters,
): void {
  c.set("edgwayAiTokenCounters", counters);
}

const schema = kongSchema("ai-rate-limiting-advanced");
type Config = PluginConfig<typeof schema>;
type Provider = NonNullable<Config["llm_providers"]>[number];

const REQUEST_PROMPT = "requestPrompt";

/** Kong's client identifier, falling back to the client IP. */
function identifier(c: Context, config: Config): string {
  const consumer = getConsumer(c);
  const by: Partial<Record<string, string | undefined>> = {
    consumer: consumer?.id,
    "consumer-group": consumer?.id,
    credential: consumer
      ? c.req.header(HEADER.credentialIdentifier)
      : undefined,
    service: getRoute(c)?.service?.id,
    header: config.header_name ? c.req.header(config.header_name) : undefined,
    path: config.path && c.req.path === config.path ? c.req.path : undefined,
  };
  return (
    by[config.identifier ?? "consumer"] ?? c.req.header(HEADER.clientIp) ?? ""
  );
}

const counterKey = (prefix: string, provider: Provider) =>
  `${prefix}:${provider.name}:${provider.window_size}`;

/** The tokens an answer used, by `tokens_count_strategy`; undefined without a `usage`. */
function tokensOf(text: string, config: Config): number | undefined {
  let usage: Record<string, unknown> | undefined;
  try {
    usage = JSON.parse(text).usage;
  } catch {
    // Server-sent events: the last event carrying a usage.
    for (const line of text.split("\n")) {
      const data = line.startsWith("data:") ? line.slice(5).trim() : "";
      if (!data || data === "[DONE]") continue;
      try {
        usage = JSON.parse(data).usage ?? usage;
      } catch {
        // not JSON: skip
      }
    }
  }
  if (!usage) return undefined;
  const field =
    config.tokens_count_strategy === "prompt_tokens" ||
    config.tokens_count_strategy === "completion_tokens"
      ? config.tokens_count_strategy
      : "total_tokens";
  const tokens = Number(usage[field]);
  return Number.isFinite(tokens) ? tokens : undefined;
}

/** A stream that passes chunks through and keeps (the tail of) the text. */
function collecting(onEnd: (text: string) => Promise<void>) {
  const chunks: Uint8Array[] = [];
  let size = 0;
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      controller.enqueue(chunk);
      chunks.push(chunk);
      size += chunk.byteLength;
      while (size > AI.usageScanBytes && chunks.length > 1) {
        size -= (chunks.shift() as Uint8Array).byteLength;
      }
    },
    async flush() {
      const decoder = new TextDecoder();
      await onEnd(
        chunks.map((c) => decoder.decode(c, { stream: true })).join("") +
          decoder.decode(),
      );
    },
  });
}

export default definePlugin({
  name: "ai-rate-limiting-advanced",
  version: "1.0.0",
  priority: 905,
  config: schema,
  enforces: "rate-limit",
  access: (config) => async (c, next) => {
    const counters = c.get("edgwayAiTokenCounters");
    if (!counters) return problemResponse(ERR.INTERNAL);
    const route = getRoute(c);
    const prefix = await sha256Hex(
      [
        route?.route.id ?? "",
        route?.service?.id ?? "",
        identifier(c, config),
      ].join(":"),
    );
    c.set("edgwayAiTokenKey", prefix);

    const providers = config.llm_providers ?? [];
    const exceeded: Provider[] = [];
    const headers: Record<string, string> = {};
    let retryAfter = 0;
    for (const provider of providers) {
      const key = counterKey(prefix, provider);
      const { used, resetSeconds } = await counters.get(
        key,
        provider.window_size,
      );
      // requestPrompt counts this request too (denied ones, unless disable_penalty).
      const prompt = provider.name === REQUEST_PROMPT;
      const counted = prompt ? used + 1 : used;
      if (prompt && !config.disable_penalty) {
        await counters.add(key, provider.window_size, 1);
      }
      const over = prompt
        ? counted > provider.limit
        : counted >= provider.limit;
      if (over) {
        exceeded.push(provider);
        retryAfter = Math.max(retryAfter, resetSeconds);
      }
      const suffix = `${provider.window_size}-${provider.name}`;
      headers[`${AI.rateLimitLimit}-${suffix}`] = String(provider.limit);
      headers[`${AI.rateLimitRemaining}-${suffix}`] = String(
        Math.max(provider.limit - counted, 0),
      );
    }

    if (exceeded.length > 0) {
      const jitter = Math.floor(
        Math.random() * ((config.retry_after_jitter_max ?? 0) + 1),
      );
      const res = problemResponse(
        {
          ...ERR.AI_RATE_LIMITED,
          status: config.error_code ?? ERR.AI_RATE_LIMITED.status,
        },
        {
          detail: config.error_hide_providers
            ? undefined
            : `${config.error_message ?? ""}${exceeded.map((p) => p.name).join(", ")}`,
        },
      );
      res.headers.set(HEADER.retryAfter, String(retryAfter + jitter));
      if (!config.hide_client_headers) {
        for (const [name, value] of Object.entries(headers))
          res.headers.set(name, value);
      }
      return res;
    }

    // requestPrompt without the penalty: count the allowed request now.
    if (config.disable_penalty) {
      for (const provider of providers) {
        if (provider.name === REQUEST_PROMPT) {
          await counters.add(
            counterKey(prefix, provider),
            provider.window_size,
            1,
          );
        }
      }
    }
    await next();
    if (!config.hide_client_headers) {
      for (const [name, value] of Object.entries(headers))
        c.res.headers.set(name, value);
    }
  },
  body_filter: (config) => (c) => {
    const counters = c.get("edgwayAiTokenCounters");
    const prefix = c.get("edgwayAiTokenKey");
    const served = c.res.headers.get(HEADER.llmModel)?.split("/")[0];
    const provider = (config.llm_providers ?? []).find(
      (p) => p.name === served,
    );
    if (!counters || prefix === undefined || !provider) return undefined;
    return collecting(async (text) => {
      const tokens = tokensOf(text, config);
      if (tokens)
        await counters.add(
          counterKey(prefix, provider),
          provider.window_size,
          tokens,
        );
    });
  },
});
