/**
 * Kong's correlation-id (priority 100001) on hono/request-id: keep the id a
 * client (or an earlier proxy) sent in `header_name`, or generate one with
 * Kong's `uuid`, `uuid#counter` or `tracker` generators (UUIDs from the
 * `uuidv7` package's v4 generator). The id goes to the upstream in the same
 * header, is available as Hono's `requestId` variable, and goes back to the
 * client with `echo_downstream`.
 */
import { CORRELATION_ID } from "@edgway/constants";
import { definePlugin, type PluginConfig } from "@edgway/plugin-sdk";
import { kongSchema } from "@edgway/schema";
import type { Context } from "hono";
import { requestId } from "hono/request-id";
import { uuidv4 } from "uuidv7";

const schema = kongSchema("correlation-id");
type Config = PluginConfig<typeof schema>;

/**
 * This isolate's id and request counter (Kong's per-worker uuid and counter).
 * The id is made on first use: Workers forbid random values in global scope.
 */
let isolate: string | undefined;
let counter = 0;

function generate(c: Context, generator: Config["generator"]): string {
  counter += 1;
  isolate ??= uuidv4();
  if (generator === "uuid") return uuidv4();
  if (generator === "tracker") {
    const colo = (c.req.raw as { cf?: { colo?: string } }).cf?.colo;
    return [
      colo ?? CORRELATION_ID.unknownColo,
      isolate,
      counter,
      Date.now(),
    ].join(CORRELATION_ID.trackerSeparator);
  }
  return [isolate, counter].join(CORRELATION_ID.counterSeparator);
}

export default definePlugin({
  name: "correlation-id",
  version: "1.0.0",
  priority: 100001,
  config: schema,
  access: (config) => {
    const name = config.header_name ?? "";
    const middleware = requestId({
      // No header name: hono/request-id then always asks the generator (which
      // keeps the incoming id, `#` included, as Kong does) and adds no
      // response header; echo_downstream decides that below.
      headerName: "",
      generator: (c) => c.req.header(name) || generate(c, config.generator),
    });
    return async (c, next) => {
      await middleware(c, async () => {
        const id = c.get("requestId");
        if (c.req.header(name) !== id) {
          const headers = new Headers(c.req.raw.headers);
          headers.set(name, id);
          c.req.raw = new Request(c.req.raw, { headers });
        }
        await next();
      });
    };
  },
  header_filter: (config) => (c) => {
    const name = config.header_name ?? "";
    if (config.echo_downstream) c.res.headers.set(name, c.get("requestId"));
  },
});
