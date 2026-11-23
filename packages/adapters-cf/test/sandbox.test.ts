import {
  createExecutionContext,
  env,
  waitOnExecutionContext,
} from "cloudflare:test";
import { KV_KEY, SANDBOX } from "@edgway/constants";
import { sha256Hex } from "@edgway/core";
import { ERR, errorHandler } from "@edgway/errors";
import { Hono } from "hono";
import { CompactSign, exportJWK, generateKeyPair } from "jose";
import { describe, expect, it } from "vitest";
import {
  createDataPlane,
  createWorkerLoaderSandbox,
  type DataPlaneEnv,
  type PluginFactory,
  type Snapshot,
  type SnapshotSandboxPlugin,
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

/** Uploaded plugins, as their authors write them. */
const CODE = {
  rewrite: `
    export async function access(request, config) {
      if (request.headers.has("x-deny")) {
        return { response: new Response("denied", { status: 403 }) };
      }
      const url = new URL(request.url);
      url.searchParams.set("sandboxed", config.tag);
      return { request: new Request(url, request) };
    }
    export async function header_filter(response, config) {
      const headers = new Headers(response.headers);
      headers.set("x-sandboxed", config.tag);
      return { response: new Response(null, { status: response.status, headers }) };
    }`,
  network: `
    export async function access() {
      try {
        await fetch("https://api.example/");
        return { response: new Response("reached") };
      } catch (error) {
        return { response: new Response(String(error), { status: 418 }) };
      }
    }`,
  spoof: `
    export async function access(request) {
      const headers = new Headers(request.headers);
      headers.set("x-consumer-id", "admin");
      headers.set("x-sandboxed", "1");
      return { request: new Request(request.url, { headers }) };
    }`,
  ip: `
    export async function access(request) {
      const headers = new Headers(request.headers);
      headers.set("cf-connecting-ip", "10.0.0.1");
      return { request: new Request(request.url, { headers }) };
    }`,
  names: `
    export async function access(request, config, env) {
      return { response: Response.json(Object.keys(env)) };
    }`,
  bindings: `
    export async function access(request, config, env) {
      const reached = await (await env.ALLOWED.fetch("https://capability/probe")).text();
      return { response: Response.json({ names: Object.keys(env), reached }) };
    }`,
};

const plugin = (
  name: string,
  code: string,
  extra: Partial<SnapshotSandboxPlugin> = {},
): SnapshotSandboxPlugin => ({
  name,
  version: "1.0.0",
  priority: 500,
  code,
  ...extra,
});

const UPLOADED = [
  plugin("rewrite", CODE.rewrite, { cpu_ms: 20 }),
  plugin("network", CODE.network),
  plugin("bindings", CODE.bindings, { bindings: ["ALLOWED", "SECRET"] }),
];

const snapshot = (
  route: string,
  name: string,
  sandbox_plugins = UPLOADED,
): Snapshot => ({
  services: [
    { id: "svc", protocol: "https", host: "api.example", port: 443, path: "/" },
  ],
  routes: [
    { id: "sandboxed", service_id: "svc", paths: [route], strip_path: true },
    { id: "plain", service_id: "svc", paths: ["/plain"], strip_path: true },
  ],
  consumers: [],
  plugins: [{ id: "p1", name, route_id: "sandboxed", config: { tag: "t1" } }],
  sandbox_plugins,
});

/** A bundled plugin with the same name as an uploaded one. */
const bundled: PluginFactory = {
  name: "rewrite",
  instance: ({ id, scope }) => ({
    id,
    name: "rewrite",
    priority: 500,
    scope,
    handlers: {
      access: async (c, next) => {
        await next();
        c.res.headers.set("x-bundled", "yes");
      },
    },
  }),
};

function gateway(
  loader: WorkerLoader = env.LOADER,
  plugins: PluginFactory[] = [],
) {
  const app = new Hono<{ Bindings: DataPlaneEnv }>();
  app.all(
    "*",
    createDataPlane<DataPlaneEnv>({
      plugins,
      // The gateway's allow-list: a service binding as ALLOWED; SECRET isn't on it.
      sandbox: (uploaded) =>
        createWorkerLoaderSandbox({
          loader,
          plugins: uploaded,
          bindings: { ALLOWED: env.CAPABILITY },
        }),
    }),
  );
  app.onError(errorHandler());
  return async (path: string, init: RequestInit = {}) => {
    const ctx = createExecutionContext();
    const res = await app.request(path, init, bindings, ctx);
    await waitOnExecutionContext(ctx);
    return res;
  };
}

type Echo = { url: string; method: string; body: string };

describe("PluginSandbox on the Worker Loader", () => {
  it("runs an uploaded plugin's access and header_filter in a Dynamic Worker", async () => {
    await publish(snapshot("/s", "rewrite"));
    const call = gateway();
    const res = await call("https://gw.test/s/x?keep=1", {
      method: "POST",
      body: "streamed body",
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-sandboxed")).toBe("t1");
    const echo = await res.json<Echo>();
    expect(echo.url).toBe("https://api.example/x?keep=1&sandboxed=t1");
    // The body never entered the sandbox; it reached the upstream.
    expect(echo).toMatchObject({ method: "POST", body: "streamed body" });

    const denied = await call("https://gw.test/s/x", {
      headers: { "x-deny": "1" },
    });
    expect(denied.status).toBe(403);
    expect(await denied.text()).toBe("denied");
  });

  it("gives a plugin no network by default", async () => {
    await publish(snapshot("/n", "network"));
    const res = await gateway()("https://gw.test/n");
    expect(res.status).toBe(418);
    expect(await res.text()).toMatch(/not permitted to access the internet/);
  });

  it("hands a plugin only the bindings the gateway allow-lists", async () => {
    await publish(snapshot("/b", "bindings"));
    const res = await gateway()("https://gw.test/b");
    expect(await res.json()).toEqual({
      names: ["ALLOWED"],
      reached: "capability:/probe",
    });
  });

  it("loads each plugin with its limits and globalOutbound: null", async () => {
    const loaded: WorkerLoaderWorkerCode[] = [];
    const recording = {
      get: (_id: string, code: () => WorkerLoaderWorkerCode) => {
        loaded.push(code());
        return env.LOADER.get(_id, code);
      },
    } as unknown as WorkerLoader;
    await publish(snapshot("/l", "rewrite"));
    expect((await gateway(recording)("https://gw.test/l")).status).toBe(200);
    expect(loaded[0]).toMatchObject({
      mainModule: SANDBOX.harnessModule,
      limits: { cpuMs: 20, subRequests: SANDBOX.subRequests },
      globalOutbound: null,
      env: {},
    });
    expect(Object.keys(loaded[0]?.modules ?? {})).toEqual([
      SANDBOX.harnessModule,
      SANDBOX.pluginModule,
    ]);
  });

  it("caps the limits an uploaded plugin asks for", async () => {
    const loaded: WorkerLoaderWorkerCode[] = [];
    const recording = {
      get: (_id: string, code: () => WorkerLoaderWorkerCode) => {
        loaded.push(code());
        return env.LOADER.get(_id, code);
      },
    } as unknown as WorkerLoader;
    await publish(
      snapshot("/cap", "names", [
        plugin("names", CODE.names, {
          cpu_ms: 1_000_000,
          sub_requests: 1_000_000,
        }),
      ]),
    );
    await gateway(recording)("https://gw.test/cap");
    expect(loaded[0]?.limits).toEqual({
      cpuMs: SANDBOX.maxCpuMs,
      subRequests: SANDBOX.maxSubRequests,
    });
  });

  it("never lets an uploaded plugin set identity headers", async () => {
    await publish(snapshot("/spoof", "spoof", [plugin("spoof", CODE.spoof)]));
    const res = await gateway(env.LOADER)("https://gw.test/spoof");
    expect(res.status).toBe(200);
    const echo = await res.json<{ consumerId: string | null; url: string }>();
    expect(echo.consumerId).toBeNull();
  });

  it("never lets an uploaded plugin change the client IP", async () => {
    await publish(snapshot("/ip", "ip", [plugin("ip", CODE.ip)]));
    const res = await gateway(env.LOADER)("https://gw.test/ip", {
      headers: { "cf-connecting-ip": "203.0.113.7" },
    });
    expect(res.status).toBe(200);
    const echo = await res.json<{ realIp: string | null }>();
    expect(echo.realIp).toBe("203.0.113.7");
  });

  it("loads a new Dynamic Worker when only the limits or bindings change", async () => {
    const loaded: { id: string; code: WorkerLoaderWorkerCode }[] = [];
    const recording = {
      get: (id: string, code: () => WorkerLoaderWorkerCode) => {
        loaded.push({ id, code: code() });
        return env.LOADER.get(id, code);
      },
    } as unknown as WorkerLoader;
    // A fresh data plane per publish (the config store re-reads once a second).
    const call = (path: string) => gateway(recording)(path);
    const withConfig = (extra: Partial<SnapshotSandboxPlugin>) =>
      snapshot("/c", "names", [
        plugin("names", CODE.names, { bindings: ["ALLOWED"], ...extra }),
      ]);
    await publish(withConfig({ cpu_ms: 20 }));
    await call("https://gw.test/c");
    // The same code and version: a tighter limit, then a revoked binding.
    await publish(withConfig({ cpu_ms: 5 }));
    await call("https://gw.test/c");
    await publish(withConfig({ cpu_ms: 5, bindings: [] }));
    const revoked = await call("https://gw.test/c");
    // One Worker per distinct configuration (each is asked for per phase).
    const workers = [...new Map(loaded.map((l) => [l.id, l.code])).values()];
    expect(workers.map((w) => w.limits?.cpuMs)).toEqual([20, 5, 5]);
    expect(workers.map((w) => Object.keys(w.env ?? {}))).toEqual([
      ["ALLOWED"],
      ["ALLOWED"],
      [],
    ]);
    // The plugin now runs without the binding it lost.
    expect(await revoked.json()).toEqual([]);
  });

  it("stops a plugin that exceeds its CPU limit without affecting the pipeline", async () => {
    // Cloudflare enforces cpuMs only when deployed: this loader
    // throws as the runtime does when the limit is hit.
    const killed = {
      get: () => ({
        getEntrypoint: () => ({
          invoke: async () => {
            throw new Error("Worker exceeded CPU time limit.");
          },
        }),
      }),
    } as unknown as WorkerLoader;
    await publish(snapshot("/cpu", "rewrite"));
    const call = gateway(killed);
    const res = await call("https://gw.test/cpu");
    expect(res.status).toBe(ERR.INTERNAL.status);
    expect(await res.json()).toMatchObject({ code: ERR.INTERNAL.code });
    // The next requests are served: other routes, and the same one again.
    const plain = await call("https://gw.test/plain/x");
    expect(plain.status).toBe(200);
    expect((await plain.json<Echo>()).url).toBe("https://api.example/x");
    expect((await call("https://gw.test/cpu")).status).toBe(
      ERR.INTERNAL.status,
    );
  });

  it("prefers a bundled plugin over an uploaded one with the same name", async () => {
    await publish(snapshot("/w", "rewrite"));
    const res = await gateway(env.LOADER, [bundled])("https://gw.test/w");
    expect(res.headers.get("x-bundled")).toBe("yes");
    expect(res.headers.get("x-sandboxed")).toBeNull();
  });

  it("fails closed on an uploaded plugin when the gateway has no sandbox", async () => {
    await publish(snapshot("/x", "rewrite"));
    const app = new Hono<{ Bindings: DataPlaneEnv }>();
    app.all("*", createDataPlane<DataPlaneEnv>({ plugins: [] }));
    app.onError(errorHandler());
    const ctx = createExecutionContext();
    const res = await app.request("https://gw.test/x", {}, bindings, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(ERR.PLUGIN_UNAVAILABLE.status);
    expect(await res.json()).toMatchObject({
      code: ERR.PLUGIN_UNAVAILABLE.code,
    });
  });
});
