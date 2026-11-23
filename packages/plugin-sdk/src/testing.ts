/**
 * Test kit for plugins: run one plugin in front of a fake upstream, through
 * the same runner the gateway uses, and collect what it emitted. Runs in the
 * Workers vitest pool (`cloudflare:test` supplies the ExecutionContext).
 */

import {
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import {
  type Consumer,
  type PluginEvent,
  type PluginInstance,
  type PluginScope,
  routePhases,
  setConsumer,
} from "@edgway/core";
import { errorHandler } from "@edgway/errors";
import { type Context, type Handler, Hono } from "hono";
import type {
  EntitySchema,
  InstanceInput,
  Plugin,
  PluginInput,
} from "./index.js";

/** An upstream that echoes what reached it: method, URL, headers and body. */
export const echoUpstream: Handler = async (c) =>
  c.json({
    method: c.req.method,
    url: c.req.url,
    headers: Object.fromEntries(c.req.raw.headers),
    body: await c.req.text(),
  });

export interface TestAppOptions {
  /** The upstream handler; defaults to `echoUpstream`. */
  upstream?: Handler;
  /** Instance scope and ids; the route is "test-route", the service "test-service". */
  instance?: Partial<Omit<InstanceInput, "config">>;
  /** Set this consumer before the plugin runs, as an auth plugin would. */
  consumer?: Consumer;
  /** Extra plugins to run alongside (e.g. an auth plugin before acl). */
  plugins?: PluginInstance[];
  env?: Record<string, unknown>;
}

const SCOPE: PluginScope = { route: "test-route", service: "test-service" };

/** A gateway route with one plugin in front of a fake upstream. */
export function testApp<S extends EntitySchema>(
  plugin: Plugin<S>,
  config: PluginInput<S>,
  options: TestAppOptions = {},
) {
  const events: PluginEvent[] = [];
  const upstreamCalls: Request[] = [];
  const instance = plugin.instance({
    id: `${plugin.name}-under-test`,
    scope: SCOPE,
    ...options.instance,
    config,
  });
  const app = new Hono();
  app.onError(errorHandler());
  if (options.consumer) {
    const consumer = options.consumer;
    app.use(async (c, next) => {
      setConsumer(c, consumer);
      await next();
    });
  }
  const upstream = options.upstream ?? echoUpstream;
  app.all(
    "*",
    routePhases(
      {
        route: SCOPE.route,
        service: SCOPE.service,
        plugins: [instance, ...(options.plugins ?? [])],
      },
      { onEvent: (event) => events.push(event) },
    ),
    (c) => {
      upstreamCalls.push(c.req.raw.clone());
      return upstream(c, async () => {});
    },
  );

  const ctx = createExecutionContext();
  return {
    app,
    events,
    upstreamCalls,
    /** Send a request; path may be absolute or relative to https://gateway.test. */
    request: (path: string, init?: RequestInit) =>
      app.fetch(
        new Request(new URL(path, "https://gateway.test"), init),
        options.env ?? {},
        ctx,
      ),
    /** Wait for log-phase work (waitUntil). */
    settle: () => waitOnExecutionContext(ctx),
  };
}

/** Run `fn` with a real Hono Context for `request` (unit-testing handlers). */
export async function withContext<T>(
  request: Request,
  fn: (c: Context) => T | Promise<T>,
): Promise<T> {
  let result: T | undefined;
  const app = new Hono();
  app.all("*", async (c) => {
    result = await fn(c);
    return c.body(null);
  });
  await app.fetch(request, {}, createExecutionContext());
  return result as T;
}
