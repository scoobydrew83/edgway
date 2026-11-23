/**
 * Core's `PluginSandbox` on Cloudflare Dynamic Workers (the Worker Loader,
 * beta). Each uploaded plugin runs in its own Dynamic Worker:
 * per-invocation `cpuMs` and `subRequests` limits, no network
 * (`globalOutbound: null`), and only the bindings it names that the gateway
 * allow-lists. The fixed harness (`harness.json`) calls the plugin's phase
 * function over RPC.
 *
 * Only headers cross into the sandbox: `access` gets the request without its
 * body, which stays in the gateway's isolate and streams upstream;
 * `header_filter` gets the status and headers. A plugin that fails or hits a
 * limit throws, and the plugin runner applies `on_error` (fail-closed for
 * sandboxed plugins).
 */
import { IDENTITY_HEADERS, SANDBOX } from "@edgway/constants";
import {
  type OnError,
  type Phase,
  type PluginInstance,
  type PluginSandbox,
  type PluginScope,
  sha256Hex,
} from "@edgway/core";
import { ERR, fail } from "@edgway/errors";
import harness from "./harness.json" with { type: "json" };

/** A `sandbox_plugins` row as the snapshot carries it. */
export interface SnapshotSandboxPlugin {
  id?: string;
  name: string;
  version: string;
  priority: number;
  code: string;
  cpu_ms?: number | null;
  sub_requests?: number | null;
  bindings?: string[] | null;
}

/** Core's sandbox input, plus the response `header_filter` works on. */
export interface SandboxInvocation {
  plugin: string;
  version: string;
  phase: Phase;
  config: unknown;
  request: Request;
  response?: Response;
}

export interface SandboxResult {
  request?: Request;
  response?: Response;
}

export interface WorkerLoaderSandbox extends PluginSandbox {
  invoke(input: SandboxInvocation): Promise<SandboxResult>;
}

export interface WorkerLoaderSandboxOptions {
  /** The gateway's Worker Loader binding. */
  loader: WorkerLoader;
  /** The published sandbox plugins. */
  plugins: readonly SnapshotSandboxPlugin[];
  /** Bindings a plugin may ask for by name: the gateway's allow-list. */
  bindings?: Record<string, unknown>;
}

/** The harness's RPC method, as seen from the gateway. */
interface Harness {
  invoke(
    phase: Phase,
    config: unknown,
    message: Request | Response | undefined,
  ): Promise<SandboxResult>;
}

const HARNESS = harness.lines.join("\n");

export function createWorkerLoaderSandbox(
  options: WorkerLoaderSandboxOptions,
): WorkerLoaderSandbox {
  const plugins = new Map(options.plugins.map((p) => [p.name, p]));
  const allowed = options.bindings ?? {};

  /** Everything the loader gets for a plugin, and the id naming it. */
  const workerOf = (plugin: SnapshotSandboxPlugin) => {
    const names = (plugin.bindings ?? []).filter((binding) =>
      Object.hasOwn(allowed, binding),
    );
    const code = {
      compatibilityDate: SANDBOX.compatibilityDate,
      mainModule: SANDBOX.harnessModule,
      modules: {
        [SANDBOX.harnessModule]: HARNESS,
        [SANDBOX.pluginModule]: plugin.code,
      },
      // What the plugin asks for, capped.
      limits: {
        cpuMs: Math.min(plugin.cpu_ms ?? SANDBOX.cpuMs, SANDBOX.maxCpuMs),
        subRequests: Math.min(
          plugin.sub_requests ?? SANDBOX.subRequests,
          SANDBOX.maxSubRequests,
        ),
      },
    };
    // The loader keeps a loaded Worker per id, so the id covers everything it
    // was given: a change to the code, limits or bindings loads a new one.
    const id = sha256Hex(JSON.stringify({ ...code, bindings: names })).then(
      (hash) => `${plugin.name}@${plugin.version}:${hash}`,
    );
    const env = Object.fromEntries(names.map((name) => [name, allowed[name]]));
    return { id, code: { ...code, globalOutbound: null, env } };
  };
  const workers = new Map<SnapshotSandboxPlugin, ReturnType<typeof workerOf>>();

  return {
    async invoke({ plugin: name, phase, config, request, response }) {
      const plugin = plugins.get(name);
      if (!plugin) fail(ERR.INTERNAL, { extensions: { plugin: name } });
      let loaded = workers.get(plugin);
      if (!loaded) {
        loaded = workerOf(plugin);
        workers.set(plugin, loaded);
      }
      const { code } = loaded;
      const worker = options.loader.get(await loaded.id, () => code);
      const entry = worker.getEntrypoint() as unknown as Harness;
      // Awaited here, so a failed call is handled where it is made.
      return await entry.invoke(
        phase,
        config,
        phase === "header_filter" ? response : request,
      );
    },
  };
}

/** Methods whose requests carry no body. */
const BODYLESS = new Set(["GET", "HEAD"]);

/** The request's method, URL and headers; the body stays here. */
const headersOnly = (request: Request) =>
  new Request(request.url, {
    method: request.method,
    headers: request.headers,
  });

/**
 * One plugin factory per sandbox plugin, for the data plane: instances run
 * `access` and `header_filter` in the sandbox.
 */
export function sandboxPlugins(
  plugins: readonly SnapshotSandboxPlugin[],
  sandbox: WorkerLoaderSandbox,
) {
  return plugins.map((plugin) => ({
    name: plugin.name,
    instance: (input: {
      id: string;
      scope: PluginScope;
      config: unknown;
      on_error?: OnError;
    }): PluginInstance => {
      const call = (phase: Phase, request: Request, response?: Response) =>
        sandbox.invoke({
          plugin: plugin.name,
          version: plugin.version,
          phase,
          config: input.config,
          request: headersOnly(request),
          response,
        });
      return {
        id: input.id,
        name: plugin.name,
        priority: plugin.priority,
        scope: input.scope,
        // Untrusted code that breaks stops the request, unless configured.
        on_error: input.on_error ?? "fail-closed",
        handlers: {
          access: async (c, next) => {
            const original = c.req.raw;
            const out = await call("access", original);
            if (out.response) return out.response;
            if (out.request) {
              const method = out.request.method;
              // Identity headers are the auth plugins' to set: a sandboxed
              // plugin's copies are replaced with what the request had
              //.
              const headers = new Headers(out.request.headers);
              for (const name of IDENTITY_HEADERS) {
                const trusted = original.headers.get(name);
                if (trusted === null) headers.delete(name);
                else headers.set(name, trusted);
              }
              c.req.raw = new Request(out.request.url, {
                method,
                headers,
                body: BODYLESS.has(method) ? null : original.body,
                duplex: "half",
              } as RequestInit);
            }
            await next();
          },
          header_filter: async (c) => {
            const out = await call(
              "header_filter",
              c.req.raw,
              new Response(null, {
                status: c.res.status,
                headers: c.res.headers,
              }),
            );
            if (out.response) {
              c.res = new Response(c.res.body, {
                status: out.response.status,
                headers: out.response.headers,
              });
            }
          },
        },
      };
    },
  }));
}
