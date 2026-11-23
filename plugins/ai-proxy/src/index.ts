/**
 * Kong's ai-proxy (priority 770): the route's upstream is an LLM. Clients
 * speak OpenAI's chat or completions format (Kong's `llm/v1/chat` and
 * `llm/v1/completions`); `preserve` forwards the body as it is.
 *
 * - **OpenAI** (and any OpenAI-format `upstream_url`): plain pass-through,
 *   with the configured model, options and auth applied; the answer streams
 *   back untouched.
 * - **Anthropic**: translated by the Vercel AI SDK (`@ai-sdk/anthropic`).
 * - **Workers AI**: `model.provider: "openai"` with an `upstream_url` in the
 *   `workers-ai:` scheme, through `workers-ai-provider` over the
 *   gateway's AI binding (`setWorkersAi`).
 *
 * When the provider fails (a 429 or 5xx, or no answer) and the gateway has the
 * AI binding, the request falls back to Workers AI. The answer
 * names its model in `x-edgway-llm-model` (`<provider>/<model>`), which
 * ai-rate-limiting-advanced reads.
 */
import { createAnthropic } from "@ai-sdk/anthropic";
import { AI, HEADER, MEDIA_TYPE } from "@edgway/constants";
import { getRoute, routePhases } from "@edgway/core";
import { ERR, fail } from "@edgway/errors";
import { definePlugin, type PluginConfig } from "@edgway/plugin-sdk";
import { kongSchema } from "@edgway/schema";
import type { Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { createWorkersAI } from "workers-ai-provider";
import {
  type Model,
  type OpenAiRequest,
  type RouteType,
  toEventStream,
  toFinishReason,
  toPrompt,
  toResponseBody,
  toUsage,
} from "./format.js";

/** How ai-proxy reaches a provider (supplied by the gateway; plugins don't fetch). */
export type AiTransport = typeof fetch;

declare module "hono" {
  interface ContextVariableMap {
    edgwayWorkersAi?: Ai;
    edgwayAiTransport?: AiTransport;
  }
}

/** Called by the gateway with its Workers AI binding (`env.AI`), when it has one. */
export function setWorkersAi(c: Context, binding: Ai): void {
  c.set("edgwayWorkersAi", binding);
}

/** Called by the gateway with the transport for provider calls. */
export function setAiTransport(c: Context, transport: AiTransport): void {
  c.set("edgwayAiTransport", transport);
}

const schema = kongSchema("ai-proxy");
type Config = PluginConfig<typeof schema>;

/** Statuses after which the Workers AI fallback is tried. */
const FAILED = (status: number) => status === 429 || status >= 500;

/**
 * Kong's `auth`: a header, or a query or body parameter. With `allow_override`,
 * a value the client sent wins over the configured one.
 */
function applyAuth(
  config: Config,
  request: Request,
  headers: Headers,
  body: OpenAiRequest,
  url?: URL,
) {
  const auth = config.auth;
  if (!auth) return;
  const override = auth.allow_override === true;
  if (auth.header_name) {
    const value =
      (override ? request.headers.get(auth.header_name) : null) ??
      auth.header_value;
    if (value) headers.set(auth.header_name, value);
  }
  if (auth.param_name) {
    if (auth.param_location === "body") {
      if (!(override && body[auth.param_name] !== undefined)) {
        if (auth.param_value) body[auth.param_name] = auth.param_value;
      }
    } else if (url) {
      const value =
        (override
          ? new URL(request.url).searchParams.get(auth.param_name)
          : null) ?? auth.param_value;
      if (value) url.searchParams.set(auth.param_name, value);
    }
  }
}

/** The configured model and options over the client's request. */
function applyModel(config: Config, body: OpenAiRequest): OpenAiRequest {
  const options =
    config.model.options ?? ({} as NonNullable<Config["model"]["options"]>);
  return {
    ...body,
    ...(config.model.name ? { model: config.model.name } : {}),
    ...(body.max_tokens === undefined && options.max_tokens != null
      ? { max_tokens: options.max_tokens }
      : {}),
    ...(body.temperature === undefined && options.temperature != null
      ? { temperature: options.temperature }
      : {}),
    ...(body.top_p === undefined && options.top_p != null
      ? { top_p: options.top_p }
      : {}),
  };
}

/**
 * A deadline for the provider's answer (Kong's service `read_timeout`): it
 * aborts the call until `answered()`, so a provider that hangs fails over;
 * a streamed answer then runs as long as it streams.
 */
interface Deadline {
  signal: AbortSignal;
  answered: () => void;
}

function deadline(c: Context): Deadline {
  // The router's service is the snapshot's, which carries Kong's timeouts.
  const service = getRoute(c)?.service as { read_timeout?: number } | undefined;
  const controller = new AbortController();
  // Capped, so it always ends before the plugin runner's timeout.
  const timer = setTimeout(
    () => controller.abort(),
    Math.min(service?.read_timeout ?? AI.timeoutMs, AI.timeoutMs),
  );
  return { signal: controller.signal, answered: () => clearTimeout(timer) };
}

/**
 * One call to an AI SDK provider model, answered in OpenAI's format. The
 * model is called directly (`doGenerate`/`doStream`), not through `ai`'s
 * generateText: in workerd its diagnostics_channel tracing leaks a rejected
 * promise per failed call (`hasSubscribers` is a method there).
 */
async function viaSdk(
  model: Model,
  modelName: string,
  route: RouteType,
  body: OpenAiRequest,
  limit?: Deadline,
): Promise<Response> {
  const prompt = toPrompt(route, body);
  if (!prompt) fail(ERR.AI_REQUEST_INVALID);
  const options = {
    prompt,
    maxOutputTokens: body.max_tokens,
    temperature: body.temperature,
    topP: body.top_p,
    topK: body.top_k,
    abortSignal: limit?.signal,
  };
  if (!body.stream) {
    const result = await model.doGenerate(options);
    limit?.answered();
    const text = result.content
      .map((part) => (part.type === "text" ? part.text : ""))
      .join("");
    return Response.json(
      toResponseBody(
        route,
        modelName,
        text,
        toFinishReason(result.finishReason),
        toUsage(result.usage),
      ),
    );
  }
  const { stream } = await model.doStream(options);
  const reader = stream.getReader();
  let finish: { finishReason: string; usage: ReturnType<typeof toUsage> } = {
    finishReason: "stop",
    usage: toUsage(undefined),
  };
  /** The next text delta; undefined at the end. Errors are thrown. */
  const nextDelta = async (): Promise<string | undefined> => {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return undefined;
      if (value.type === "text-delta") return value.delta;
      if (value.type === "error") throw value.error;
      if (value.type === "finish") {
        finish = {
          finishReason: toFinishReason(value.finishReason),
          usage: toUsage(value.usage),
        };
      }
    }
  };
  // The first delta before answering, so a provider that fails up front can fail over.
  const first = await nextDelta();
  limit?.answered();
  async function* deltas() {
    for (let d = first; d !== undefined; d = await nextDelta()) yield d;
  }
  return new Response(
    toEventStream(route, modelName, deltas(), async () => finish),
    { headers: { [HEADER.contentType]: MEDIA_TYPE.eventStream } },
  );
}

/** The HTTP status an SDK or fetch failure stands for (0 when there was no answer). */
const statusOf = (error: unknown) =>
  Number((error as { statusCode?: number }).statusCode ?? 0);

/** One request to the configured provider (or the Workers AI fallback). */
async function proxy(
  config: Config,
  c: Context,
  text: string,
): Promise<Response> {
  const route = config.route_type;
  let body: OpenAiRequest;
  try {
    body = JSON.parse(text);
  } catch {
    fail(ERR.AI_REQUEST_INVALID);
  }
  const streaming = config.response_streaming ?? "allow";
  if (body.stream && streaming === "deny") fail(ERR.AI_STREAMING_DENIED);
  if (streaming === "always") body.stream = true;
  body = applyModel(config, body);

  const provider = config.model.provider;
  const options =
    config.model.options ?? ({} as NonNullable<Config["model"]["options"]>);
  const upstream = options.upstream_url ?? undefined;
  const workersAi = c.get("edgwayWorkersAi");
  const label = (name: string, model?: string) => `${name}/${model ?? ""}`;
  const answer = (res: Response, name: string, model?: string) => {
    const out = new Response(res.body, res);
    if (config.model_name_header !== false) {
      out.headers.set(HEADER.llmModel, label(name, model));
    }
    return out;
  };

  // Workers AI through the binding, as the configured model or the fallback.
  const viaWorkersAi = async (model: string, limit?: Deadline) => {
    if (!workersAi) fail(ERR.AI_PROVIDER_FAILED);
    if (route === "preserve") fail(ERR.AI_REQUEST_INVALID);
    let res: Response;
    try {
      res = await viaSdk(
        createWorkersAI({ binding: workersAi })(model),
        model,
        route,
        { ...body, model },
        limit,
      );
    } catch (error) {
      if ((error as { getResponse?: unknown }).getResponse) throw error;
      fail(ERR.AI_PROVIDER_FAILED, {
        extensions: { provider: AI.workersAiProvider },
      });
    } finally {
      limit?.answered();
    }
    return answer(res, AI.workersAiProvider, model);
  };
  const canFallBack = workersAi !== undefined && route !== "preserve";
  const fallback = (failed: () => Response | Promise<Response>) =>
    canFallBack ? viaWorkersAi(AI.fallbackModel) : failed();

  if (upstream?.startsWith(AI.workersAiScheme)) {
    return viaWorkersAi(body.model ?? AI.fallbackModel, deadline(c));
  }

  if (provider === "openai") {
    const url = new URL(
      upstream ??
        (route === "llm/v1/completions"
          ? AI.openaiUrl.completions
          : AI.openaiUrl.chat),
    );
    const headers = new Headers({ [HEADER.contentType]: MEDIA_TYPE.json });
    applyAuth(config, c.req.raw, headers, body, url);
    const transport = c.get("edgwayAiTransport");
    if (!transport) fail(ERR.AI_PROVIDER_FAILED);
    const limit = deadline(c);
    let res: Response;
    try {
      res = await transport(url, {
        method: "POST",
        headers,
        body: JSON.stringify(route === "preserve" ? JSON.parse(text) : body),
        signal: limit.signal,
      });
    } catch {
      // No answer: the connection failed or the deadline passed.
      return fallback(() => fail(ERR.AI_PROVIDER_FAILED));
    } finally {
      limit.answered();
    }
    if (FAILED(res.status) && canFallBack) {
      await res.body?.cancel();
      return viaWorkersAi(AI.fallbackModel);
    }
    return answer(res, provider, body.model);
  }

  if (provider === "anthropic" && route !== "preserve") {
    const headers = new Headers();
    applyAuth(config, c.req.raw, headers, body);
    const apiKey = headers.get(HEADER.apiKey) ?? "";
    headers.delete(HEADER.apiKey);
    if (options.anthropic_version) {
      headers.set(HEADER.anthropicVersion, options.anthropic_version);
    }
    const transport = c.get("edgwayAiTransport");
    if (!transport) fail(ERR.AI_PROVIDER_FAILED);
    const anthropic = createAnthropic({
      apiKey,
      fetch: transport,
      headers: Object.fromEntries(headers),
      // Kong's upstream_url is the full messages URL; the SDK wants its base.
      ...(upstream ? { baseURL: upstream.replace(/\/messages\/?$/, "") } : {}),
    });
    const model = body.model ?? "";
    const limit = deadline(c);
    try {
      return answer(
        await viaSdk(anthropic(model), model, route, body, limit),
        provider,
        model,
      );
    } catch (error) {
      limit.answered();
      if ((error as { getResponse?: unknown }).getResponse) throw error;
      const status = statusOf(error);
      if (status !== 0 && !FAILED(status)) {
        fail(ERR.AI_PROVIDER_FAILED, { extensions: { status } });
      }
      // status 0: no answer at all.
      return fallback(() =>
        fail(ERR.AI_PROVIDER_FAILED, { extensions: { status } }),
      );
    }
  }

  fail(ERR.AI_REQUEST_INVALID, { extensions: { provider } });
}

const plugin = definePlugin({
  name: "ai-proxy",
  version: "1.0.0",
  priority: 770,
  config: schema,
  access: (config) => {
    // hono/body-limit refuses a larger body (Content-Length or counted).
    const limited = bodyLimit({
      maxSize: config.max_request_body_size ?? 0,
      onError: () => fail(ERR.AI_REQUEST_INVALID),
    });
    return async (c) => {
      let res: Response | undefined;
      await limited(c, async () => {
        res = await proxy(config, c, await c.req.text());
      });
      return res;
    };
  },
});

/**
 * ai-proxy answers the request itself: its runner timeout outlasts the
 * provider deadline, and a failure stops the request (500) rather than
 * falling through to the route's service host.
 */
const instance = (input: Parameters<typeof plugin.instance>[0]) => ({
  ...plugin.instance(input),
  timeoutMs: input.timeoutMs ?? AI.runnerTimeoutMs,
  on_error: "fail-closed" as const,
});

export default {
  ...plugin,
  instance,
  // Plain Hono middleware gets the same timeout and failure rule.
  middleware: (config: unknown) =>
    routePhases({ plugins: [instance({ id: plugin.name, config })] }),
};
