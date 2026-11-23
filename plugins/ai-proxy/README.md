# @edgway/plugin-ai-proxy

Kong's `ai-proxy` for Edgway (priority 770): the route's upstream is an LLM. Clients speak OpenAI's chat or completions format (`route_type` `llm/v1/chat`, `llm/v1/completions`); `preserve` forwards the body unchanged.

| `model.provider` | How |
| --- | --- |
| `openai` | Pass-through to OpenAI (or `model.options.upstream_url`), with `model.name`, `max_tokens`, `temperature`, `top_p` and `auth` applied. Streamed answers pass through untouched. |
| `anthropic` | Translated by the Vercel AI SDK's `@ai-sdk/anthropic` (chat and completions, whole or streamed). `upstream_url` may point at another Anthropic-compatible base; `anthropic_version` is sent as the API version. |
| Workers AI | `provider: "openai"` with `model.options.upstream_url` starting `workers-ai:`: `workers-ai-provider` over the gateway's AI binding, `model.name` as the Workers AI model. |

- **Failover:** when the provider answers 429 or 5xx, or doesn't answer within the route's service `read_timeout` (Kong's default, 60 s, without one), and the gateway has the AI binding, the request is answered by Workers AI (`@cf/meta/llama-3.1-8b-instruct`). Without the binding, the provider's answer is returned (502 `EDG-PLG-006` when there was none). The deadline covers the wait for the answer; a streamed answer then runs as long as it streams.
- **Runner timeout and failure:** the provider deadline is capped at 60 s, and the plugin runner's timeout for ai-proxy is 65 s (`timeoutMs` on the instance overrides it), so the deadline always ends first. ai-proxy always fails closed: if it breaks or times out, the request answers 500. It never falls through to the route's service host.
- `x-edgway-llm-model: <provider>/<model>` names the model that answered (Kong's `X-Kong-LLM-Model`; off with `model_name_header: false`). `ai-rate-limiting-advanced` reads it.
- `response_streaming`: `deny` refuses `stream: true` (`EDG-PLG-008`); `always` forces it.
- The gateway supplies the transport for provider calls with `setAiTransport(c, fetch)` (plugins don't call `fetch` themselves) and the AI binding with `setWorkersAi(c, env.AI)`. Without a transport, OpenAI and Anthropic answer 502 (`EDG-PLG-006`).

## Not supported

- Providers other than OpenAI, Anthropic and Workers AI (`azure`, `bedrock`, `cohere`, `gemini`, `huggingface`, `llama2`, `mistral`) answer 400 (`EDG-PLG-005`).
- Tool calls and images in translated requests (text only); `logging`; cost options (`input_cost`, `output_cost`).
- The AI SDK providers are called directly, not through `ai`'s `generateText`: in workerd its diagnostics_channel tracing leaks a rejected promise per failed call (`hasSubscribers` is a method there, not a property).
