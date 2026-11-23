import { describe, expect, it } from "vitest";
import { boundedBodyTransform } from "../src/index";

const run = (chunks: string[], max: number, rewrite: (s: string) => string) =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const c of chunks) controller.enqueue(new TextEncoder().encode(c));
        controller.close();
      },
    }).pipeThrough(boundedBodyTransform(max, rewrite)),
  ).text();

describe("boundedBodyTransform", () => {
  it("rewrites a body within the limit, across chunks", async () => {
    expect(await run(["ab", "cd"], 10, (s) => s.toUpperCase())).toBe("ABCD");
  });

  it("passes a body over the limit through untouched", async () => {
    expect(await run(["abc", "def", "ghi"], 5, (s) => s.toUpperCase())).toBe(
      "abcdefghi",
    );
  });

  it("passes the body unchanged when the rewrite throws", async () => {
    const res = await run(["{bad"], 10, (s) => JSON.stringify(JSON.parse(s)));
    expect(res).toBe("{bad");
  });
});
