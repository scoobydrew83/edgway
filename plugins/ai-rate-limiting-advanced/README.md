# @edgway/plugin-ai-rate-limiting-advanced

Kong's `ai-rate-limiting-advanced` for Edgway (priority 905): token limits per LLM provider and window (`llm_providers`: `name`, `limit`, `window_size` in seconds).

This is an independent implementation of the plugin's public configuration schema (vendored from Kong's MIT-licensed schemas). It contains no Kong code, and it is not Kong's plugin, nor affiliated with or endorsed by Kong Inc. (see the repository's NOTICE).

- Tokens are counted from the `usage` in the answer, which `ai-proxy` always gives in OpenAI's shape (a JSON body, or the last server-sent event carrying a usage). `tokens_count_strategy` picks `total_tokens`, `prompt_tokens` or `completion_tokens`.
- The answering provider is the one `ai-proxy` names in `x-edgway-llm-model`. An answer from a provider without a limit (e.g. a Workers AI fallback) isn't counted.
- Before the request, every configured provider's counter for this client is checked; an exhausted one answers `error_code` (429, `EDG-PLG-007`) with `Retry-After` (plus up to `retry_after_jitter_max` seconds) and, unless `error_hide_providers`, the providers in the detail.
- `requestPrompt` counts requests; denied requests count too unless `disable_penalty`.
- Headers `x-ai-ratelimit-limit-<window>-<provider>` and `x-ai-ratelimit-remaining-<window>-<provider>`, unless `hide_client_headers`.
- The client is identified by `identifier` (`consumer`, `credential`, `service`, `header`, `path`; `consumer-group` uses the consumer), falling back to the client IP. Counters are scoped to the route and service.
- The gateway supplies the counters with `setAiTokenCounters(c, counters)`.

## Not supported

- `window_type: sliding` (counters are fixed windows), `strategy` and `redis` (the gateway's counters decide), `tokens_count_strategy: cost`, `request_prompt_count_function`, `dictionary_name`, `sync_rate`.
