# @edgway/plugin-ai-prompt-guard

Kong's `ai-prompt-guard` for Edgway (priority 771): regex allow and deny lists for the prompts of LLM requests, checked before `ai-proxy` sends them.

- Reads OpenAI chat `messages` or a completions `prompt` (text, or the text parts of a message).
- A deny match, or no allow match when `allow_patterns` is set, answers 400 (`EDG-PLG-004`).
- Every `user` message is checked; with `allow_all_conversation_history`, only the latest. `match_all_roles` checks every role.
- The body is read up to `max_request_body_size` (default 8 KiB); a larger body, or one that isn't an LLM request, answers 400 (`EDG-PLG-005`). The body is passed on to later plugins unchanged.

## Differences from Kong

- Patterns are JavaScript regular expressions, not Lua/PCRE. An invalid pattern can't match, so it denies (fail closed).
- Errors are Edgway problems (`EDG-PLG-004`/`005`) instead of Kong's `{"error":{"message":"bad request"}}`.
