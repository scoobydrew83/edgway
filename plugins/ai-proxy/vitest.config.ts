import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

/**
 * Stand-ins for the LLM providers: OpenAI echoes the request it got;
 * Anthropic answers its messages API. A prompt "fail <status>" makes either
 * answer that status; "slow <ms>" delays the answer.
 */
export default defineConfig({
  plugins: [
    cloudflareTest({
      miniflare: {
        compatibilityDate: "2025-04-14",
        compatibilityFlags: ["nodejs_compat"],
        outboundService: async (request: Request) => {
          const url = new URL(request.url);
          const text = await request.text();
          const slow = Number(text.match(/slow (\d+)/)?.[1]);
          if (slow) await new Promise((done) => setTimeout(done, slow));
          const failing = Number(text.match(/fail (\d{3})/)?.[1]);
          if (failing) return new Response("down", { status: failing });
          if (url.hostname === "api.openai.com") {
            if (text.includes('"stream":true')) {
              return new Response(
                'data: {"passthrough":true}\n\ndata: [DONE]\n\n',
                {
                  headers: { "content-type": "text/event-stream" },
                },
              );
            }
            return Response.json({
              upstream: "openai",
              url: request.url,
              authorization: request.headers.get("authorization"),
              body: JSON.parse(text),
              usage: {
                prompt_tokens: 3,
                completion_tokens: 4,
                total_tokens: 7,
              },
            });
          }
          if (url.hostname === "api.anthropic.com") {
            const body = JSON.parse(text);
            return Response.json({
              id: "msg_1",
              type: "message",
              role: "assistant",
              model: body.model,
              content: [
                {
                  type: "text",
                  text: `anthropic:${request.headers.get("x-api-key")}:${body.messages.at(-1).content[0].text}`,
                },
              ],
              stop_reason: "end_turn",
              stop_sequence: null,
              usage: { input_tokens: 5, output_tokens: 6 },
            });
          }
          return Response.error();
        },
      },
    }),
  ],
  test: { include: ["test/**/*.test.ts"] },
});
