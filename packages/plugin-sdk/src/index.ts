/**
 * Define an Edgway plugin: Kong's name, priority and config schema, and phase
 * handlers built from the parsed config. Each plugin is also plain Hono
 * middleware (`plugin.middleware(config)`), usable outside Edgway.
 */
import {
  type OnError,
  type PluginHandlers,
  type PluginInstance,
  type PluginScope,
  routePhases,
} from "@edgway/core";
import type { MessageDescriptor } from "@edgway/i18n";
import type { MiddlewareHandler } from "hono";
import type { z } from "zod";

export { boundedBodyTransform } from "./body.js";
export {
  authenticated,
  type IdentifyOptions,
  identifyAnonymous,
  identifyConsumer,
  type KongConsumer,
} from "./consumer.js";

/** A plugin entity schema (`{ config, ... }`), as `kongSchema(name)` returns. */
export type EntitySchema = z.ZodType<{ config?: unknown }>;

/** The parsed `config` object of a plugin entity, with Kong's defaults applied. */
export type PluginConfig<S extends EntitySchema> = NonNullable<
  z.output<S>["config"]
>;

/** The raw `config` a user writes (before defaults), for typed callers. */
export type PluginInput<S extends EntitySchema> =
  z.input<S> extends { config?: infer C } ? NonNullable<C> : never;

/** Builds each phase handler from the parsed config. */
export interface PhaseFactories<C> {
  rewrite?: (config: C) => MiddlewareHandler;
  access?: (config: C) => MiddlewareHandler;
  header_filter?: (config: C) => NonNullable<PluginHandlers["header_filter"]>;
  body_filter?: (config: C) => NonNullable<PluginHandlers["body_filter"]>;
  log?: (config: C) => NonNullable<PluginHandlers["log"]>;
}

export interface PluginDefinition<S extends EntitySchema>
  extends PhaseFactories<PluginConfig<S>> {
  /** Kong's plugin name, so decK files map one to one. */
  name: string;
  version: string;
  /** Kong's priority for this plugin. */
  priority: number;
  /** The entity schema: `kongSchema(name)`, or zod for Edgway-only plugins. */
  config: S;
  /** Authentication and rate-limit plugins fail closed by default. */
  enforces?: PluginInstance["enforces"];
  /** i18n message descriptors the plugin renders (keys only, no prose). */
  messages?: Record<string, MessageDescriptor>;
}

export interface InstanceInput {
  id: string;
  scope?: PluginScope;
  /** The raw `config` from the snapshot or decK file. */
  config: unknown;
  on_error?: OnError;
  timeoutMs?: number;
}

export interface Plugin<S extends EntitySchema> extends PluginDefinition<S> {
  /** Validate and apply Kong's defaults to a raw config. Throws on invalid input. */
  parse(config: unknown): PluginConfig<S>;
  /** The phase handlers for a parsed config. */
  handlers(config: PluginConfig<S>): PluginHandlers;
  /** A configured instance for the @edgway/core runner. */
  instance(input: InstanceInput): PluginInstance;
  /** Plain Hono middleware running every phase of this plugin. */
  middleware(config: unknown): MiddlewareHandler;
}

export function definePlugin<S extends EntitySchema>(
  definition: PluginDefinition<S>,
): Plugin<S> {
  const parse = (config: unknown): PluginConfig<S> =>
    (definition.config.parse({ config: config ?? {} }).config ??
      {}) as PluginConfig<S>;

  const handlers = (config: PluginConfig<S>): PluginHandlers => ({
    rewrite: definition.rewrite?.(config),
    access: definition.access?.(config),
    header_filter: definition.header_filter?.(config),
    body_filter: definition.body_filter?.(config),
    log: definition.log?.(config),
  });

  const instance = (input: InstanceInput): PluginInstance => ({
    id: input.id,
    name: definition.name,
    priority: definition.priority,
    scope: input.scope ?? {},
    enforces: definition.enforces,
    on_error: input.on_error,
    timeoutMs: input.timeoutMs,
    handlers: handlers(parse(input.config)),
  });

  return {
    ...definition,
    parse,
    handlers,
    instance,
    middleware: (config) =>
      routePhases({ plugins: [instance({ id: definition.name, config })] }),
  };
}
