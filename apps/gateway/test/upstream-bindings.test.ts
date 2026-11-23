/** a service tag reaches only the gateway's UPSTREAM_* bindings. */
import { upstreamFetchers } from "@edgway/adapters-cf";
import type { UPSTREAM } from "@edgway/constants";
import { describe, expect, expectTypeOf, it } from "vitest";
import type { Env } from "../src/data-plane";

const fetcher = () => ({ fetch: async () => new Response("ok") });

describe("upstream bindings", () => {
  it("passes only UPSTREAM_* fetchers, never the gateway's own bindings", () => {
    const env = {
      CONFIG_KV: fetcher(),
      CONFIG_PUBLIC_KEY: "{}",
      CONFIG_VERSION: fetcher(),
      RATE_LIMIT_COUNTER: fetcher(),
      AI: fetcher(),
      LOADER: fetcher(),
      ORDERS_SERVICE: fetcher(),
      UPSTREAM_ORDERS: fetcher(),
      UPSTREAM_PRIVATE_API: fetcher(),
      UPSTREAM_NOT_A_FETCHER: "a var",
    };
    expect(Object.keys(upstreamFetchers(env)).sort()).toEqual([
      "UPSTREAM_ORDERS",
      "UPSTREAM_PRIVATE_API",
    ]);
  });

  it("names none of the gateway's own bindings with the upstream prefix", () => {
    type Prefixed = Extract<
      keyof Env,
      `${typeof UPSTREAM.bindingPrefix}${string}`
    >;
    expectTypeOf<Prefixed>().toEqualTypeOf<never>();
  });
});
