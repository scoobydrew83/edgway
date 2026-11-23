/**
 * Test fixture: examples/deck/demo.yaml as a data-plane snapshot, the way the
 * admin's compiler (Step 5) will produce one. Route ids are the scaffold's
 * seed ids (route_<name>), so the characterization tests see the same
 * x-edgway-route values; the seed API key is provisioned hashed, as key-auth
 * credentials are.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Snapshot } from "@edgway/adapters-cf";
import { parse } from "yaml";

const SEED_KEY = "edgway_dev_seed_key_do_not_use_in_prod";

interface DeckPlugin {
  name: string;
  config?: Record<string, unknown>;
}
interface DeckRoute {
  name: string;
  paths?: string[];
  methods?: string[];
  strip_path?: boolean;
  plugins?: DeckPlugin[];
}
interface DeckService {
  name: string;
  url: string;
  routes?: DeckRoute[];
}
interface DeckFile {
  services?: DeckService[];
  consumers?: { username: string }[];
}

const routeId = (name: string) => `route_${name.replaceAll("-", "_")}`;

export function snapshotFromDeck(path: string): Snapshot {
  const deck = parse(readFileSync(path, "utf8")) as DeckFile;
  const snapshot: Snapshot = {
    services: [],
    routes: [],
    plugins: [],
    consumers: [],
    keyauth_credentials: [],
  };
  for (const service of deck.services ?? []) {
    const url = new URL(service.url);
    const protocol = url.protocol.replace(":", "");
    const serviceId = `service_${service.name.replaceAll("-", "_")}`;
    snapshot.services.push({
      id: serviceId,
      name: service.name,
      protocol,
      host: url.hostname,
      port: url.port ? Number(url.port) : protocol === "https" ? 443 : 80,
      path: url.pathname,
    });
    for (const route of service.routes ?? []) {
      const id = routeId(route.name);
      snapshot.routes.push({
        id,
        service_id: serviceId,
        paths: route.paths,
        methods: route.methods,
        strip_path: route.strip_path ?? true,
      });
      for (const plugin of route.plugins ?? []) {
        snapshot.plugins.push({
          id: `${id}_${plugin.name}`,
          name: plugin.name,
          route_id: id,
          config: plugin.config ?? {},
        });
      }
    }
  }
  return {
    ...snapshot,
    consumers: (deck.consumers ?? []).map((consumer) => ({
      id: `consumer_${consumer.username}`,
      username: consumer.username,
    })),
    keyauth_credentials: [
      {
        id: "credential_dev_seed",
        consumer_id: "consumer_dev-seed",
        key_hash: createHash("sha256").update(SEED_KEY).digest("hex"),
      },
    ],
  };
}
