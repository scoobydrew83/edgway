/**
 * A snapshot as a decK-style file: `_format_version`, routes nested under
 * their service, and Kong's `*_id` columns as decK's references (`service`,
 * `route`, `consumer`, by id), in YAML (the `yaml` package). Not checked
 * against decK's schema: it is a view, not an export.
 */
import { stringify } from "yaml";

/** decK's file format version. */
const FORMAT_VERSION = "3.0";

type Row = Record<string, unknown>;

/** Kong columns → decK's reference fields. */
const REFERENCES: Record<string, string> = {
  service_id: "service",
  route_id: "route",
  consumer_id: "consumer",
  consumer_group_id: "consumer_group",
};

const referenced = (row: Row, omit?: string): Row =>
  Object.fromEntries(
    Object.entries(row)
      .filter(([key]) => key !== omit)
      .map(([key, value]) => [REFERENCES[key] ?? key, value]),
  );

export function toDeck(snapshot: Record<string, unknown[]>): string {
  const {
    services = [],
    routes = [],
    ...rest
  } = snapshot as Record<string, Row[]>;
  const nested = new Set<Row>();
  const deck = {
    _format_version: FORMAT_VERSION,
    services: services.map((service) => {
      const own = routes.filter((r) => r.service_id === service.id);
      for (const route of own) nested.add(route);
      return {
        ...service,
        routes: own.map((route) => referenced(route, "service_id")),
      };
    }),
    routes: routes.filter((r) => !nested.has(r)).map((r) => referenced(r)),
    ...Object.fromEntries(
      Object.entries(rest).map(([name, rows]) => [
        name,
        rows.map((row) => referenced(row)),
      ]),
    ),
  };
  return stringify(deck, { sortMapEntries: false });
}
