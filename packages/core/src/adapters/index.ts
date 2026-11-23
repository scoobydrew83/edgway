/**
 * The portability boundary (PRD "Custom-code register": adapters). Interfaces
 * only; the Cloudflare implementations live in @edgway/adapters-cf.
 */
import type { Context } from "hono";
import type { Phase } from "../runner/types.js";

/** Where a request goes: a public URL, a Service Binding or a Workers VPC service. */
export interface UpstreamTarget {
  kind: "url" | "binding" | "vpc";
  /** Absolute URL for `url`; the binding or VPC service name otherwise. */
  target: string;
  /** Path and query to send upstream. */
  path: string;
  connectTimeoutMs?: number;
  readTimeoutMs?: number;
  writeTimeoutMs?: number;
  retries?: number;
}

export interface Upstream {
  /** Forward the request with its body streamed, never buffered. */
  forward(c: Context, target: UpstreamTarget): Promise<Response>;
}

/** A published, signed config snapshot (PRD "Architecture"). */
export interface ConfigSnapshot<T = unknown> {
  version: number;
  config: T;
}

export interface ConfigStore<T = unknown> {
  /** The current snapshot; implementations cache it per isolate. */
  current(): Promise<ConfigSnapshot<T>>;
}

/** hono-rate-limiter's store contract, so its middleware works on our stores. */
export type { Store as RateLimitStore } from "hono-rate-limiter";

export interface CachePutOptions {
  ttlSeconds: number;
  tags?: string[];
}

export interface CacheStore {
  match(key: string): Promise<Response | undefined>;
  put(key: string, response: Response, options: CachePutOptions): Promise<void>;
  purge(selector: { tags?: string[]; prefixes?: string[] }): Promise<void>;
}

/** Runs an untrusted plugin phase outside the gateway's isolate. */
export interface PluginSandbox {
  invoke(input: {
    plugin: string;
    version: string;
    phase: Phase;
    config: unknown;
    request: Request;
  }): Promise<{ request?: Request; response?: Response }>;
}

/** Resolves Kong vault references such as `{vault://env/NAME}`. */
export interface SecretResolver {
  isReference(value: string): boolean;
  resolve(reference: string): Promise<string>;
}

export interface AdminPrincipal {
  id: string;
  email?: string;
  roles: string[];
}

export interface AdminIdentity {
  /** The admin behind a request, or undefined when it isn't authenticated. */
  authenticate(request: Request): Promise<AdminPrincipal | undefined>;
}
