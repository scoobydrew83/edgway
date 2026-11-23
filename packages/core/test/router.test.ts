import { ERR } from "@edgway/errors";
import type { tables } from "@edgway/schema";
import { describe, expect, it } from "vitest";
import {
  buildGateway,
  compileRouter,
  getRoute,
  type KongRoute,
  type KongService,
  type PluginInstance,
} from "../src/index";
import { normalizePath } from "../src/router/paths";
import pathTable from "./fixtures/kong-path-handling.json";

// The router reads snapshot rows as they are.
const _routeRow: KongRoute = {} as typeof tables.routes.$inferSelect;
const _serviceRow: KongService = {} as typeof tables.services.$inferSelect;
void _routeRow;
void _serviceRow;

const service: KongService = { id: "svc", host: "upstream.internal" };

function select(
  routes: KongRoute[],
  method: string,
  path: string,
  host = "domain.org",
  headers: Record<string, string> = {},
) {
  const router = compileRouter(routes, [service]);
  return router.match(
    new Request(`http://${host}${path}`, {
      method,
      headers: { host, ...headers },
    }),
  );
}

describe("Kong path handling (Kong's own fixture table, v0 and v1)", () => {
  type Row = (typeof pathTable.tests)[number];
  const label = (t: Row, kind: string) =>
    `line ${t.line} ${kind} ${t.path_handling}: service ${t.service_path}, route ${t.route_path ?? "(host)"}, strip ${t.strip_path}, ${t.request_path} → ${t.expected_path}`;

  const run = (t: Row, paths: string[] | undefined, host: string) => {
    const routes: KongRoute[] = [
      {
        id: "r",
        service_id: "s",
        strip_path: t.strip_path,
        path_handling: t.path_handling,
        paths,
        hosts: paths ? undefined : [host],
      },
    ];
    const router = compileRouter(routes, [
      { id: "s", host: "upstream", path: t.service_path },
    ]);
    return router.match(
      new Request(`http://${host}${t.request_path}`, { headers: { host } }),
    );
  };

  it.each(pathTable.tests.map((t) => [label(t, "plain"), t] as const))(
    "%s",
    (_, t) => {
      const match = run(
        t,
        t.route_path ? [t.route_path] : undefined,
        "localbin.com",
      );
      expect(match?.upstreamPath).toBe(t.expected_path);
    },
  );

  it.each(
    pathTable.tests
      .filter((t) => t.route_path)
      .map((t) => [label(t, "regex"), t] as const),
  )("%s", (_, t) => {
    // Kong's spec turns each prefix into an equivalent regex: ~/[0]?<rest>.
    const regex = `~/[0]?${(t.route_path as string).slice(1)}`;
    const match = run(t, [regex], "localbin.com");
    expect(match?.upstreamPath).toBe(t.expected_path);
  });
});

/** Matching priority cases from Kong's spec/01-unit/08-router_spec.lua (3.9.0). */
describe("Kong matching priority", () => {
  const cases: {
    name: string;
    routes: KongRoute[];
    request: [string, string, string?, Record<string, string>?];
    expected: string;
  }[] = [
    {
      name: "wildcard host + path wins when the plain host route's path doesn't match (l.1398)",
      routes: [
        { id: "1", hosts: ["*.route.com"], paths: ["/path1"] },
        { id: "2", hosts: ["plain.route.com"], paths: ["/path2"] },
      ],
      request: ["GET", "/path1", "plain.route.com"],
      expected: "1",
    },
    {
      name: "plain host + path over a matching wildcard host (l.1431)",
      routes: [
        { id: "1", hosts: ["*.route.com"], paths: ["/path1"] },
        { id: "2", hosts: ["plain.route.com"], paths: ["/path2"] },
      ],
      request: ["GET", "/path2", "plain.route.com"],
      expected: "2",
    },
    {
      name: "plain host beats wildcard host on otherwise equal routes",
      routes: [
        { id: "1", hosts: ["*.route.com"], paths: ["/p"] },
        { id: "2", hosts: ["plain.route.com"], paths: ["/p"] },
      ],
      request: ["GET", "/p", "plain.route.com"],
      expected: "2",
    },
    {
      name: "[host] and [uri] have higher priority than [method] (l.2492; PATCH for TRACE, which fetch rejects)",
      routes: [
        { id: "1", hosts: ["domain-1.org", "domain-2.org"] },
        { id: "2", methods: ["PATCH"] },
        { id: "3", paths: ["/my-route"] },
        { id: "4", paths: ["/my-route"], hosts: ["domain-1.org"] },
      ],
      request: ["PATCH", "/my-route", "domain-1.org"],
      expected: "4",
    },
    {
      name: "more [headers] has priority over longer [paths] (l.2862)",
      routes: [
        { id: "1", headers: { version: ["v1"] }, paths: ["/my-route/hello"] },
        {
          id: "2",
          headers: { version: ["v1"], location: ["us-east"] },
          paths: ["/my-route"],
        },
      ],
      request: [
        "GET",
        "/my-route/hello",
        "domain.org",
        { version: "v1", location: "us-east" },
      ],
      expected: "2",
    },
    {
      name: "prefix matching ignores regex_priority (l.4941)",
      routes: [
        { id: "1", paths: ["/.*"], hosts: ["domain-1.org"] },
        { id: "2", paths: ["/"], hosts: ["domain-2.org"], regex_priority: 5 },
        { id: "3", paths: ["/v1"], hosts: ["domain-2.org"] },
      ],
      request: ["GET", "/v1", "domain-2.org"],
      expected: "3",
    },
    {
      name: "regex and prefix paths of one route get separate priorities: regex (l.4993)",
      routes: [
        {
          id: "1",
          paths: ["~/some/thing/else", "/foo"],
          hosts: ["domain-1.org"],
        },
        { id: "2", paths: ["/foo/bar"], hosts: ["domain-1.org"] },
      ],
      request: ["GET", "/some/thing/else", "domain-1.org"],
      expected: "1",
    },
    {
      name: "regex and prefix paths of one route get separate priorities: longer prefix (l.4993)",
      routes: [
        {
          id: "1",
          paths: ["~/some/thing/else", "/foo"],
          hosts: ["domain-1.org"],
        },
        { id: "2", paths: ["/foo/bar"], hosts: ["domain-1.org"] },
      ],
      request: ["GET", "/foo/bar", "domain-1.org"],
      expected: "2",
    },
    {
      name: "overlapping prefixes: each path length is its own priority (l.5042)",
      routes: [
        { id: "1", paths: ["/foo", "/foo/bar/baz"], hosts: ["domain-1.org"] },
        { id: "2", paths: ["/foo/bar"], hosts: ["domain-1.org"] },
      ],
      request: ["GET", "/foo/bar", "domain-1.org"],
      expected: "2",
    },
    {
      name: "overlapping prefixes: shortest still matches its own requests (l.5042)",
      routes: [
        { id: "1", paths: ["/foo", "/foo/bar/baz"], hosts: ["domain-1.org"] },
        { id: "2", paths: ["/foo/bar"], hosts: ["domain-1.org"] },
      ],
      request: ["GET", "/foo", "domain-1.org"],
      expected: "1",
    },
    {
      name: "regex paths are evaluated before prefix paths",
      routes: [
        { id: "1", paths: ["/users/123/profile"] },
        { id: "2", paths: ["~/users/\\d+"] },
      ],
      request: ["GET", "/users/123/profile"],
      expected: "2",
    },
    {
      name: "higher regex_priority wins between regex paths",
      routes: [
        { id: "1", paths: ["~/status/\\d+"], regex_priority: 0 },
        { id: "2", paths: ["~/status/(?<code>\\d+)"], regex_priority: 6 },
      ],
      request: ["GET", "/status/200"],
      expected: "2",
    },
    {
      name: "longest prefix wins",
      routes: [
        { id: "1", paths: ["/api"] },
        { id: "2", paths: ["/api/v2"] },
      ],
      request: ["GET", "/api/v2/users"],
      expected: "2",
    },
    {
      name: "a host with a port requires that port",
      routes: [
        { id: "1", hosts: ["route.com:8080"], paths: ["/"] },
        { id: "2", hosts: ["route.com"] },
      ],
      request: ["GET", "/", "route.com:8080"],
      expected: "1",
    },
  ];

  it.each(cases.map((c) => [c.name, c] as const))("%s", (_, c) => {
    const [method, path, host, headers] = c.request;
    expect(select(c.routes, method, path, host, headers)?.route.id).toBe(
      c.expected,
    );
  });
});

describe("Kong path normalization (kong.tools.uri.normalize, merge_slashes)", () => {
  it.each([
    ["//admin", "/admin"],
    ["/a//b", "/a/b"],
    ["/a/b//", "/a/b/"],
    ["/%61dmin", "/admin"],
    ["/a%2fb", "/a%2Fb"],
    ["/a%2Fb", "/a%2Fb"],
    ["/a%20b", "/a b"],
    ["/a/./b", "/a/b"],
    ["/a/../b", "/b"],
    ["/a/%2e%2e/b", "/b"],
    ["/", "/"],
  ])("%s → %s", (input, expected) => {
    expect(normalizePath(input)).toBe(expected);
  });

  it("routes //admin to the /admin route, not a catch-all", () => {
    const routes: KongRoute[] = [
      { id: "admin", paths: ["/admin"] },
      { id: "all", paths: ["/"] },
    ];
    expect(select(routes, "GET", "//admin")?.route.id).toBe("admin");
  });

  it("escapes decoded characters again on the way upstream", () => {
    const routes: KongRoute[] = [
      { id: "r", paths: ["/files"], strip_path: false },
    ];
    expect(select(routes, "GET", "/files/a%20b")?.upstreamPath).toBe(
      "/files/a%20b",
    );
    expect(select(routes, "GET", "/files/a%2fb")?.upstreamPath).toBe(
      "/files/a%2Fb",
    );
  });
});

describe("match details", () => {
  it("matches methods, hosts and headers; misses otherwise", () => {
    const routes: KongRoute[] = [
      {
        id: "r",
        methods: ["POST"],
        hosts: ["*.example.com"],
        headers: { "x-env": ["prod", "~*^canary-\\d+$"] },
        paths: ["/pay"],
      },
    ];
    const ok = (method: string, host: string, env: string) =>
      select(routes, method, "/pay", host, { "x-env": env })?.route.id;
    expect(ok("POST", "api.example.com", "PROD")).toBe("r");
    expect(ok("POST", "api.example.com", "canary-7")).toBe("r");
    expect(ok("GET", "api.example.com", "prod")).toBeUndefined();
    expect(ok("POST", "example.org", "prod")).toBeUndefined();
    expect(ok("POST", "api.example.com", "dev")).toBeUndefined();
  });

  it("anchors regex paths at the start only", () => {
    const routes: KongRoute[] = [{ id: "r", paths: ["~/v\\d"] }];
    expect(select(routes, "GET", "/v1/anything")?.route.id).toBe("r");
    expect(select(routes, "GET", "/x/v1")).toBeUndefined();
  });

  it("returns regex captures and keeps the query string", () => {
    const routes: KongRoute[] = [
      {
        id: "r",
        paths: ["~/users/(?<id>\\d+)"],
        strip_path: false,
        service_id: "svc",
      },
    ];
    const match = select(routes, "GET", "/users/42/posts?page=2");
    expect(match?.captures).toEqual({ groups: ["42"], named: { id: "42" } });
    expect(match?.upstreamPath).toBe("/users/42/posts?page=2");
  });

  it("keeps the client Host only with preserve_host", () => {
    const routes: KongRoute[] = [
      { id: "r", paths: ["/"], preserve_host: true },
    ];
    expect(select(routes, "GET", "/", "api.example.com")?.upstreamHost).toBe(
      "api.example.com",
    );
    expect(
      select([{ id: "r", paths: ["/"] }], "GET", "/", "api.example.com")
        ?.upstreamHost,
    ).toBeUndefined();
  });

  it("skips a route whose regex JS can't compile, and keeps the rest", () => {
    const router = compileRouter([
      { id: "bad", paths: ["~/(?i)foo"] },
      { id: "ok", paths: ["/"] },
    ]);
    expect(router.skipped).toEqual([{ route: "bad", unsupported: "regex" }]);
    expect(
      router.match(new Request("http://h/foo", { headers: { host: "h" } }))
        ?.route.id,
    ).toBe("ok");
  });

  it("skips routes that use fields Edgway can't match on", () => {
    const router = compileRouter([
      { id: "e", expression: 'http.path == "/x"' },
      { id: "s", snis: ["a.com"] },
      { id: "ok", paths: ["/"] },
    ]);
    expect(router.skipped).toEqual([
      { route: "e", unsupported: "expression" },
      { route: "s", unsupported: "snis" },
    ]);
  });
});

describe("buildGateway", () => {
  const routes: KongRoute[] = [
    { id: "r1", service_id: "svc", paths: ["/a"] },
    { id: "r2", service_id: "svc", paths: ["/b"] },
  ];
  const trace: string[] = [];
  const plugins: PluginInstance[] = [
    {
      id: "p1",
      name: "tag",
      priority: 1000,
      scope: { route: "r1" },
      handlers: {
        access: async (_c, next) => {
          trace.push("r1 plugin");
          await next();
        },
      },
    },
  ];
  const { app } = buildGateway({
    routes,
    services: [service],
    plugins,
    upstream: async (c, match) =>
      Response.json({ route: getRoute(c)?.route.id, path: match.upstreamPath }),
  });

  it("runs the matched route's plugins, then the upstream", async () => {
    trace.length = 0;
    const res = await app.request("http://gw/a/x");
    expect(await res.json()).toEqual({ route: "r1", path: "/x" });
    expect(trace).toEqual(["r1 plugin"]);
  });

  it("doesn't run another route's plugins", async () => {
    trace.length = 0;
    const res = await app.request("http://gw/b");
    expect(await res.json()).toEqual({ route: "r2", path: "/" });
    expect(trace).toEqual([]);
  });

  it("answers 404 when no route matches", async () => {
    const res = await app.request("http://gw/nothing");
    expect(res.status).toBe(ERR.ROUTE_NOT_FOUND.status);
    expect(await res.json()).toMatchObject({ code: ERR.ROUTE_NOT_FOUND.code });
  });
});

describe("route protocols", () => {
  const ran: string[] = [];
  const { app } = buildGateway({
    routes: [
      { id: "tls", service_id: "svc", paths: ["/tls"], protocols: ["https"] },
      {
        id: "both",
        service_id: "svc",
        paths: ["/both"],
        protocols: ["http", "https"],
      },
    ],
    services: [service],
    plugins: [
      {
        id: "p",
        name: "seen",
        priority: 1,
        scope: {},
        handlers: {
          access: async (_c, next) => {
            ran.push("plugin");
            await next();
          },
        },
      },
    ],
    upstream: async () => new Response("upstream"),
  });

  it("answers 426 to plain HTTP on an https-only route, before its plugins", async () => {
    const res = await app.request("http://domain.org/tls");
    expect(res.status).toBe(ERR.ROUTE_HTTPS_REQUIRED.status);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ code: ERR.ROUTE_HTTPS_REQUIRED.code });
    // The client isn't told which route it hit.
    expect(body).not.toHaveProperty("route");
    expect(ran).toEqual([]);
  });

  it("serves HTTPS on that route, and HTTP where the route allows it", async () => {
    expect((await app.request("https://domain.org/tls")).status).toBe(200);
    expect((await app.request("http://domain.org/both")).status).toBe(200);
  });

  it("only refuses HTTP for routes that accept HTTPS", async () => {
    // A route for other protocols (gRPC here) isn't an https-only route.
    const grpc = buildGateway({
      routes: [
        { id: "g", service_id: "svc", paths: ["/g"], protocols: ["grpcs"] },
      ],
      services: [service],
      plugins: [],
      upstream: async () => new Response("upstream"),
    }).app;
    expect((await grpc.request("http://domain.org/g")).status).not.toBe(
      ERR.ROUTE_HTTPS_REQUIRED.status,
    );
  });
});

describe("https_redirect_status_code", () => {
  const service: KongService = { id: "svc", host: "upstream.test" };
  const gateway = (code: number | null) =>
    buildGateway({
      routes: [
        {
          id: "tls",
          service_id: "svc",
          paths: ["/tls"],
          protocols: ["https"],
          https_redirect_status_code: code,
        },
      ],
      services: [service],
      plugins: [],
      upstream: async () => new Response("upstream"),
    }).app;

  for (const code of [301, 302, 307, 308]) {
    it(`redirects plain HTTP to the HTTPS URL with ${code}`, async () => {
      const res = await gateway(code).request(
        "http://domain.org:8080/tls/a?b=1",
      );
      expect(res.status).toBe(code);
      // Kong's Location: the host without its port, and the request URI.
      expect(res.headers.get("location")).toBe("https://domain.org/tls/a?b=1");
    });
  }

  it("answers 426 for Kong's default and for no value", async () => {
    for (const code of [426, null]) {
      const res = await gateway(code).request("http://domain.org/tls");
      expect(res.status).toBe(ERR.ROUTE_HTTPS_REQUIRED.status);
      expect(res.headers.get("location")).toBeNull();
    }
  });

  it("serves HTTPS whatever the redirect code", async () => {
    const res = await gateway(301).request("https://domain.org/tls");
    expect(res.status).toBe(200);
  });
});
