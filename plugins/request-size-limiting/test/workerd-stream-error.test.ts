/**
 * Documents the workerd quirk behind this package's `onUnhandledError`
 * setting: when a native consumer such as `Response.text()` (or
 * a `fetch` body) reads a JavaScript ReadableStream that fails, the consumer
 * rejects and the caller handles it, yet workerd also reports an unhandled
 * rejection. No test kit and no request clone are involved. A JS reader
 * reading the same failing stream raises no such report.
 */
import { describe, expect, it } from "vitest";
import { BodyTooLarge } from "../src/index";

const failing = () =>
  new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.error(new BodyTooLarge());
    },
  });

describe("workerd: a failing JS stream", () => {
  it("rejects a native consumer (and workerd also reports it unhandled)", async () => {
    await expect(new Response(failing()).text()).rejects.toBeInstanceOf(
      BodyTooLarge,
    );
  });

  it("rejects a JS reader without an unhandled report", async () => {
    await expect(failing().getReader().read()).rejects.toBeInstanceOf(
      BodyTooLarge,
    );
  });
});
