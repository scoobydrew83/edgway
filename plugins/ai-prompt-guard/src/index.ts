/**
 * Kong's ai-prompt-guard (priority 771; register `small-kong-plugins`): checks
 * the prompts of an LLM request (OpenAI chat `messages`, or a completions
 * `prompt`) against regex allow and deny lists before ai-proxy sends them.
 * A deny match, or no allow match when allow patterns are set, answers 400
 * (EDG-PLG-004). As in Kong, every `user` message is checked, or only the
 * latest with `allow_all_conversation_history` (the history is then let
 * through), and every role with `match_all_roles`. A completions `prompt`
 * (a string or strings) is checked too; token ids can't be, so they are
 * refused, and with allow patterns a request with no prompt to check is
 * refused. The body is read up to
 * `max_request_body_size`; a larger one is refused (EDG-PLG-005).
 */
import { ERR, fail } from "@edgway/errors";
import { definePlugin } from "@edgway/plugin-sdk";
import { kongSchema } from "@edgway/schema";
import { bodyLimit } from "hono/body-limit";

interface Message {
  role?: string;
  content?: unknown;
}

/** A message's text: a string, or the text parts of an array. */
const textOf = (content: unknown): string =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content
          .map((part) =>
            typeof part === "string"
              ? part
              : part && typeof part === "object" && "text" in part
                ? String((part as { text: unknown }).text)
                : "",
          )
          .join(" ")
      : "";

/**
 * A completions `prompt`'s texts: a string, or an array of strings. Token-id
 * arrays can't be checked, so they are refused, never let through.
 */
function promptTexts(prompt: unknown): string[] {
  if (typeof prompt === "string") return [prompt];
  if (Array.isArray(prompt) && prompt.every((p) => typeof p === "string")) {
    return prompt as string[];
  }
  fail(ERR.AI_REQUEST_INVALID);
}

export default definePlugin({
  name: "ai-prompt-guard",
  version: "1.0.0",
  priority: 771,
  // A broken policy blocks the request.
  enforces: "policy",
  config: kongSchema("ai-prompt-guard"),
  access: (config) => {
    // Invalid patterns fail closed: they can't be matched, so they deny.
    const compile = (patterns: string[] | null | undefined) =>
      (patterns ?? []).map((p) => {
        try {
          return new RegExp(p);
        } catch {
          return null;
        }
      });
    const allow = compile(config.allow_patterns);
    const deny = compile(config.deny_patterns);
    // hono/body-limit refuses a larger body (Content-Length or counted).
    const limited = bodyLimit({
      maxSize: config.max_request_body_size ?? 0,
      onError: () => fail(ERR.AI_REQUEST_INVALID),
    });

    return (c, next) =>
      limited(c, async () => {
        const text = await c.req.text();
        // Rebuilt so later plugins and the upstream can read the body again.
        c.req.raw = new Request(c.req.raw, { body: text });
        let body: { messages?: Message[]; prompt?: unknown };
        try {
          body = JSON.parse(text);
        } catch (error) {
          if ((error as { getResponse?: unknown }).getResponse) throw error;
          fail(ERR.AI_REQUEST_INVALID);
        }
        // Every prompt the request carries is checked: the chat messages
        // and a completions `prompt`, whichever are present (ai-proxy can
        // send either).
        if (!Array.isArray(body.messages) && body.prompt === undefined) {
          fail(ERR.AI_REQUEST_INVALID);
        }
        const prompts: string[] = [];
        if (Array.isArray(body.messages)) {
          const roles = body.messages.filter(
            (m) => config.match_all_roles || m.role === "user",
          );
          // Kong: with the whole history allowed, only the latest is checked.
          const checked = config.allow_all_conversation_history
            ? roles.slice(-1)
            : roles;
          prompts.push(...checked.map((m) => textOf(m.content)));
        }
        if (body.prompt !== undefined)
          prompts.push(...promptTexts(body.prompt));
        // With allow patterns, a request with nothing to check can't match
        // one: refused, not let through.
        if (allow.length > 0 && prompts.length === 0) {
          fail(ERR.AI_PROMPT_BLOCKED);
        }
        for (const prompt of prompts) {
          if (deny.some((re) => !re || re.test(prompt))) {
            fail(ERR.AI_PROMPT_BLOCKED);
          }
          if (allow.length > 0 && !allow.some((re) => re?.test(prompt))) {
            fail(ERR.AI_PROMPT_BLOCKED);
          }
        }
        await next();
      });
  },
});
