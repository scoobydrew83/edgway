/**
 * Bounded body rewriting for plugins that must see a whole body (Kong's
 * transformers). The body streams into memory up to `maxBytes`; if it ends
 * within the limit it is rewritten, otherwise everything read so far and the
 * rest are passed on untouched. Memory stays bounded either way (CLAUDE.md §4).
 */
export function boundedBodyTransform(
  maxBytes: number,
  rewrite: (body: string) => string,
): TransformStream<Uint8Array, Uint8Array> {
  let held: Uint8Array[] | undefined = [];
  let size = 0;
  return new TransformStream({
    transform(chunk, controller) {
      if (!held) {
        controller.enqueue(chunk);
        return;
      }
      size += chunk.byteLength;
      held.push(chunk);
      if (size > maxBytes) {
        // Too large to rewrite: release what was held and stream the rest.
        for (const part of held) controller.enqueue(part);
        held = undefined;
      }
    },
    flush(controller) {
      if (!held) return;
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const part of held) {
        bytes.set(part, offset);
        offset += part.byteLength;
      }
      let text: string;
      try {
        text = rewrite(new TextDecoder().decode(bytes));
      } catch {
        // Unparsable (e.g. invalid JSON): pass it on unchanged, as Kong does.
        controller.enqueue(bytes);
        return;
      }
      controller.enqueue(new TextEncoder().encode(text));
    },
  });
}
