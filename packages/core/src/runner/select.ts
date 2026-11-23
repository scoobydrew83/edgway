import type { PluginInstance, PluginScope, RequestScope } from "./types.js";

type ScopeKey = keyof PluginScope;

/**
 * Kong's plugin precedence, most specific first: when several instances of
 * one plugin apply to a request, the earliest combination here wins.
 */
const PRECEDENCE: ScopeKey[][] = [
  ["consumer", "route", "service"],
  ["consumer_group", "route", "service"],
  ["consumer", "route"],
  ["consumer", "service"],
  ["consumer_group", "route"],
  ["consumer_group", "service"],
  ["route", "service"],
  ["consumer"],
  ["consumer_group"],
  ["route"],
  ["service"],
  [],
];

export const boundKeys = (scope: PluginScope) =>
  (Object.keys(scope) as ScopeKey[]).filter((key) => scope[key] !== undefined);

function rank(scope: PluginScope): number {
  const keys = boundKeys(scope);
  return PRECEDENCE.findIndex(
    (combo) =>
      combo.length === keys.length && combo.every((key) => keys.includes(key)),
  );
}

function applies(scope: PluginScope, request: RequestScope): boolean {
  return (
    (scope.route === undefined || scope.route === request.route) &&
    (scope.service === undefined || scope.service === request.service) &&
    (scope.consumer === undefined || scope.consumer === request.consumer?.id) &&
    (scope.consumer_group === undefined ||
      (request.consumer?.consumerGroups ?? []).includes(scope.consumer_group))
  );
}

/** Kong's execution order: higher priority first; name breaks ties. */
export function byPriority(a: PluginInstance, b: PluginInstance): number {
  return b.priority - a.priority || a.name.localeCompare(b.name);
}

/**
 * The plugins that run for a request: one instance per plugin name (the most
 * specific that applies), in priority order.
 */
export function selectPlugins(
  plugins: readonly PluginInstance[],
  request: RequestScope,
): PluginInstance[] {
  const chosen = new Map<string, { plugin: PluginInstance; rank: number }>();
  for (const plugin of plugins) {
    const r = rank(plugin.scope);
    if (r < 0 || !applies(plugin.scope, request)) continue;
    const current = chosen.get(plugin.name);
    if (
      !current ||
      r < current.rank ||
      (r === current.rank && plugin.id < current.plugin.id)
    ) {
      chosen.set(plugin.name, { plugin, rank: r });
    }
  }
  return [...chosen.values()].map(({ plugin }) => plugin).sort(byPriority);
}
