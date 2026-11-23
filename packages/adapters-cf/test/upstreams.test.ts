/** Kong upstreams and targets, Service Binding and Workers VPC targets in the data plane. */
import {
  createExecutionContext,
  env,
  waitOnExecutionContext,
} from "cloudflare:test";
import { CONFIG, KV_KEY, UPSTREAM } from "@edgway/constants";
import { sha256Hex } from "@edgway/core";
import { ERR, errorHandler } from "@edgway/errors";
import { Hono } from "hono";
import { CompactSign, exportJWK, generateKeyPair } from "jose";
import { describe, expect, it } from "vitest";
import {
  createDataPlane,
  type DataPlaneEnv,
  type Snapshot,
} from "../src/index";

const keys = await generateKeyPair("EdDSA", { extractable: true });
const bindings: DataPlaneEnv = {
  CONFIG_KV: env.CONFIG_KV,
  CONFIG_PUBLIC_KEY: JSON.stringify(await exportJWK(keys.publicKey)),
};

let version = 0;
/** What the admin does on publish: sign {version, sha256}, write KV. */
async function publish(config: Snapshot) {
  version += 1;
  const snapshot = JSON.stringify(config);
  const manifest = await new CompactSign(
    new TextEncoder().encode(
      JSON.stringify({ version, sha256: await sha256Hex(snapshot) }),
    ),
  )
    .setProtectedHeader({ alg: "EdDSA" })
    .sign(keys.privateKey);
  await env.CONFIG_KV.put(
    KV_KEY.configVersion(version),
    JSON.stringify({ manifest, snapshot }),
  );
  await env.CONFIG_KV.put(KV_KEY.configCurrent, JSON.stringify({ version }));
}

/** One route to one service, with the given upstreams and targets. */
const snapshot = (
  service: Snapshot["services"][number],
  extra: Partial<Snapshot> = {},
): Snapshot => ({
  services: [service],
  routes: [
    { id: "r", service_id: service.id, paths: ["/u"], strip_path: true },
  ],
  plugins: [],
  consumers: [],
  ...extra,
});

/**
 * A data plane whose env holds the test's CAPABILITY worker as an upstream
 * binding (UPSTREAM_CAPABILITY), and the same worker under a name without
 * the prefix (CAPABILITY), which a tag must never reach.
 */
function gateway() {
  const app = new Hono<{ Bindings: DataPlaneEnv }>();
  app.all(
    "*",
    createDataPlane<DataPlaneEnv>({
      plugins: [],
      upstreamBindings: () => ({
        UPSTREAM_CAPABILITY: env.CAPABILITY,
        CAPABILITY: env.CAPABILITY,
      }),
    }),
  );
  app.onError(errorHandler());
  return async (path: string) => {
    const ctx = createExecutionContext();
    const res = await app.request(path, {}, bindings, ctx);
    await waitOnExecutionContext(ctx);
    return res;
  };
}

type Echo = { url: string };
const hostOf = async (res: Response) =>
  new URL((await res.json<Echo>()).url).host;

describe("Kong upstreams", () => {
  it("balances a service whose host names an upstream over its weighted targets", async () => {
    await publish(
      snapshot(
        { id: "svc", protocol: "https", host: "pool", port: 443, path: "/" },
        {
          upstreams: [{ id: "up", name: "pool" }],
          targets: [
            { upstream_id: "up", target: "a.test:443", weight: 300 },
            { upstream_id: "up", target: "b.test:443", weight: 100 },
          ],
        },
      ),
    );
    const call = gateway();
    const hosts: string[] = [];
    for (let i = 0; i < 8; i++) {
      const res = await call("https://gw.test/u/x");
      expect(res.status).toBe(200);
      hosts.push(await hostOf(res));
    }
    expect(hosts.filter((h) => h === "a.test").length).toBe(6);
    expect(hosts.filter((h) => h === "b.test").length).toBe(2);
  });

  it("takes a failing target out (passive health checks)", async () => {
    await publish(
      snapshot(
        { id: "svc", protocol: "https", host: "flaky", port: 443, path: "/" },
        {
          upstreams: [
            {
              id: "up",
              name: "flaky",
              healthchecks: {
                passive: {
                  unhealthy: { http_failures: 1, http_statuses: [500] },
                },
              },
            },
          ],
          targets: [
            // down.internal answers 500 (the test's outbound stub).
            { upstream_id: "up", target: "down.internal:443", weight: 100 },
            { upstream_id: "up", target: "good.test:443", weight: 100 },
          ],
        },
      ),
    );
    const call = gateway();
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await call("https://gw.test/u/x");
      statuses.push(res.status);
      await res.body?.cancel();
    }
    // An HTTP answer is final (Kong): the failing target answers once, then
    // its breaker opens and every request goes to the healthy one.
    const failed = statuses.indexOf(500);
    expect(statuses.filter((s) => s === 500)).toHaveLength(1);
    expect(statuses.slice(failed + 1).every((s) => s === 200)).toBe(true);
  });
});

describe("balancer state across publishes", () => {
  const flaky = (extra: Partial<Snapshot> = {}, goodWeight = 100) =>
    snapshot(
      { id: "svc", protocol: "https", host: "flaky", port: 443, path: "/" },
      {
        upstreams: [
          {
            id: "up",
            name: "flaky",
            healthchecks: {
              passive: {
                unhealthy: { http_failures: 1, http_statuses: [500] },
              },
            },
          },
        ],
        targets: [
          { upstream_id: "up", target: "down.internal:443", weight: 100 },
          { upstream_id: "up", target: "good.test:443", weight: goodWeight },
        ],
        ...extra,
      },
    );
  const failures = async (call: ReturnType<typeof gateway>, n: number) => {
    let failed = 0;
    for (let i = 0; i < n; i++) {
      const res = await call("https://gw.test/u/x");
      if (res.status === 500) failed++;
      await res.body?.cancel();
    }
    return failed;
  };

  it("keeps passive health when a publish leaves the upstream unchanged", async () => {
    const call = gateway();
    await publish(flaky());
    expect(await failures(call, 4)).toBe(1);
    // Another publish (a new route), same upstream and targets: the failed
    // target stays out.
    const extra = { id: "r2", service_id: "svc", paths: ["/v2"] };
    await publish(flaky({ routes: [...flaky().routes, extra] }));
    await scheduler.wait(CONFIG.versionCheckMs + 50);
    const fresh = await call("https://gw.test/v2");
    // The new version is live (its route answers), and served by good.test.
    expect(fresh.status).toBe(200);
    await fresh.body?.cancel();
    expect(await failures(call, 6)).toBe(0);
  });

  it("starts afresh when the upstream's targets change", async () => {
    const call = gateway();
    await publish(flaky());
    expect(await failures(call, 4)).toBe(1);
    await publish(flaky({}, 200));
    await scheduler.wait(CONFIG.versionCheckMs + 50);
    expect(await failures(call, 6)).toBe(1);
  });
});

describe("Service Binding and Workers VPC targets", () => {
  it("sends a service tagged edgway-binding: to that Service Binding", async () => {
    await publish(
      snapshot({
        id: "svc",
        protocol: "https",
        host: "ignored.example",
        port: 443,
        path: "/",
        tags: ["team-a", `${UPSTREAM.bindingTag}UPSTREAM_CAPABILITY`],
      }),
    );
    const res = await gateway()("https://gw.test/u/path");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("capability:/path");
  });

  it("sends a service tagged edgway-tunnel: to that Workers VPC service", async () => {
    await publish(
      snapshot({
        id: "svc",
        protocol: "https",
        host: "ignored.example",
        port: 443,
        path: "/",
        tags: [`${UPSTREAM.tunnelTag}UPSTREAM_CAPABILITY`],
      }),
    );
    const res = await gateway()("https://gw.test/u/vpc");
    expect(await res.text()).toBe("capability:/vpc");
  });

  for (const name of ["CAPABILITY", "CONFIG_KV"]) {
    it(`never sends to a binding without the UPSTREAM_ prefix (${name})`, async () => {
      for (const tag of [UPSTREAM.bindingTag, UPSTREAM.tunnelTag]) {
        await publish(
          snapshot({
            id: "svc",
            protocol: "https",
            host: "ignored.example",
            port: 443,
            path: "/",
            tags: [`${tag}${name}`],
          }),
        );
        const res = await gateway()("https://gw.test/u/x");
        expect(res.status).toBe(ERR.UPSTREAM_BINDING_MISSING.status);
        await res.body?.cancel();
      }
    });
  }

  it("looks bindings up in the Worker's env by default, UPSTREAM_* only", async () => {
    const withEnv = {
      ...bindings,
      UPSTREAM_CAPABILITY: env.CAPABILITY,
      CAPABILITY: env.CAPABILITY,
    };
    for (const [name, status] of [
      ["UPSTREAM_CAPABILITY", 200],
      ["CAPABILITY", ERR.UPSTREAM_BINDING_MISSING.status],
    ] as const) {
      await publish(
        snapshot({
          id: "svc",
          protocol: "https",
          host: "ignored.example",
          port: 443,
          path: "/",
          tags: [`${UPSTREAM.bindingTag}${name}`],
        }),
      );
      const app = new Hono<{ Bindings: DataPlaneEnv }>();
      app.all("*", createDataPlane<DataPlaneEnv>({ plugins: [] }));
      app.onError(errorHandler());
      const ctx = createExecutionContext();
      const res = await app.request("https://gw.test/u/x", {}, withEnv, ctx);
      await waitOnExecutionContext(ctx);
      expect(res.status).toBe(status);
      await res.body?.cancel();
    }
  });

  it("answers 502 for a binding the gateway doesn't pass", async () => {
    await publish(
      snapshot({
        id: "svc",
        protocol: "https",
        host: "ignored.example",
        port: 443,
        path: "/",
        tags: [`${UPSTREAM.bindingTag}UPSTREAM_MISSING`],
      }),
    );
    const res = await gateway()("https://gw.test/u/x");
    expect(res.status).toBe(ERR.UPSTREAM_BINDING_MISSING.status);
    expect(await res.json()).toMatchObject({
      code: ERR.UPSTREAM_BINDING_MISSING.code,
    });
  });
});
