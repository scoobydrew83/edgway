import {
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { type PluginInstance, setCredentialNames } from "@edgway/core";
import type { PluginInput } from "@edgway/plugin-sdk";
import { testApp } from "@edgway/plugin-sdk/testing";
import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import httpLog, {
  type HttpLogDelivery,
  type HttpLogTransport,
  setHttpLogQueue,
  setHttpLogTransport,
} from "../src/index";

type Sent = HttpLogDelivery & { timeoutMs: number };
let sent: Sent[] = [];
/** The endpoint's answer: accepted (2xx) or not, or a thrown network error. */
let accept: () => boolean = () => true;

/** Stands in for the gateway's fetch-based transport. */
const transport: HttpLogTransport = {
  deliver: async (delivery, timeoutMs) => {
    sent.push({ ...delivery, timeoutMs });
    return accept();
  },
};

beforeEach(() => {
  sent = [];
  accept = () => true;
});

type Config = PluginInput<typeof httpLog.config>;
const ENDPOINT = "https://logs.test/ingest";

function app(config: Partial<Config> = {}, queued?: HttpLogDelivery[]) {
  const plugins: PluginInstance[] = [
    {
      id: "transport",
      name: "transport",
      priority: Number.MAX_SAFE_INTEGER,
      scope: {},
      handlers: {
        access: async (c, next) => {
          setHttpLogTransport(c, transport);
          await next();
        },
      },
    },
  ];
  if (queued) {
    plugins.push({
      id: "queue",
      name: "queue",
      priority: Number.MAX_SAFE_INTEGER,
      scope: {},
      handlers: {
        access: async (c, next) => {
          setHttpLogQueue(c, { send: async (d) => void queued.push(d) });
          await next();
        },
      },
    });
  }
  return testApp(
    httpLog,
    { http_endpoint: ENDPOINT, ...config },
    {
      plugins,
      consumer: { id: "c-alice" },
    },
  );
}

describe("http-log", () => {
  it("uses Kong's name, priority and defaults", () => {
    expect(httpLog.name).toBe("http-log");
    expect(httpLog.priority).toBe(12);
    expect(httpLog.parse({ http_endpoint: ENDPOINT })).toMatchObject({
      method: "POST",
      content_type: "application/json",
      timeout: 10000,
    });
  });

  it("sends Kong's log entry after the response, with credentials redacted", async () => {
    const t = app();
    const res = await t.request("/p?x=1", {
      headers: {
        authorization: "Bearer secret",
        "cf-connecting-ip": "192.0.2.1",
        "x-a": "1",
      },
    });
    expect(res.status).toBe(200);
    await t.settle();
    expect(sent).toHaveLength(1);
    const [log] = sent;
    expect(log?.endpoint).toBe(ENDPOINT);
    expect(log?.method).toBe("POST");
    expect(log?.timeoutMs).toBe(10000);
    expect(log?.headers["content-type"]).toBe("application/json");
    const entry = JSON.parse(log?.body ?? "{}");
    expect(entry).toMatchObject({
      request: {
        method: "GET",
        uri: "/p?x=1",
        url: "https://gateway.test/p?x=1",
        querystring: { x: "1" },
        headers: { authorization: "REDACTED", "x-a": "1" },
      },
      response: { status: 200 },
      client_ip: "192.0.2.1",
      consumer: { id: "c-alice" },
      latencies: { proxy: -1 },
    });
    expect(entry.latencies.request).toBeGreaterThanOrEqual(0);
    expect(typeof entry.started_at).toBe("number");
  });

  it("redacts API keys, cookies and credential query parameters", async () => {
    const t = app();
    await t.request("/p?apikey=key-in-query&jwt=token-in-query&x=1", {
      headers: {
        apikey: "key-in-header",
        "x-api-key": "other-key",
        cookie: "session=s",
      },
    });
    await t.settle();
    const body = sent.at(-1)?.body ?? "";
    for (const secret of [
      "key-in-query",
      "token-in-query",
      "key-in-header",
      "other-key",
      "session=s",
    ]) {
      expect(body).not.toContain(secret);
    }
    const entry = JSON.parse(body);
    expect(entry.request.querystring).toEqual({
      apikey: "REDACTED",
      jwt: "REDACTED",
      x: "1",
    });
    expect(entry.request.headers).toMatchObject({
      apikey: "REDACTED",
      "x-api-key": "REDACTED",
    });
  });

  it("redacts the config's own credential names too", async () => {
    const t = testApp(
      httpLog,
      { http_endpoint: ENDPOINT },
      {
        plugins: [
          {
            id: "gateway",
            name: "gateway",
            priority: Number.MAX_SAFE_INTEGER,
            scope: {},
            handlers: {
              access: async (c, next) => {
                setHttpLogTransport(c, transport);
                // What the gateway finds in a key-auth's key_names.
                setCredentialNames(c, {
                  headers: ["x-partner-key"],
                  query: ["partner_key"],
                });
                await next();
              },
            },
          },
        ],
      },
    );
    await t.request("/p?Partner_Key=custom-in-query&x=1", {
      headers: { "X-Partner-Key": "custom-in-header" },
    });
    await t.settle();
    const body = sent.at(-1)?.body ?? "";
    expect(body).not.toContain("custom-in-query");
    expect(body).not.toContain("custom-in-header");
    const entry = JSON.parse(body);
    expect(entry.request.querystring).toEqual({
      Partner_Key: "REDACTED",
      x: "1",
    });
    expect(entry.request.headers["x-partner-key"]).toBe("REDACTED");
  });

  it("logs a URL with nothing to redact exactly as requested", async () => {
    const t = app();
    await t.request("/p?q=a%20b");
    await t.settle();
    const entry = JSON.parse(sent.at(-1)?.body ?? "{}");
    expect(entry.request.uri).toBe("/p?q=a%20b");
  });

  it("uses method and headers", async () => {
    const t = app({ method: "PUT", headers: { "x-api-key": "k" } });
    await t.request("/");
    await t.settle();
    expect(sent[0]?.method).toBe("PUT");
    expect(sent[0]?.headers["x-api-key"]).toBe("k");
  });

  it("turns credentials in the endpoint URL into Basic authorization", async () => {
    const t = app({ http_endpoint: "https://user:p%40ss@logs.test/in" });
    await t.request("/");
    await t.settle();
    expect(sent[0]?.endpoint).toBe("https://logs.test/in");
    expect(sent[0]?.headers.authorization).toBe(`Basic ${btoa("user:p@ss")}`);
  });

  it("hands a failed delivery to the retry queue", async () => {
    const queued: HttpLogDelivery[] = [];
    accept = () => false;
    const t = app({}, queued);
    await t.request("/");
    await t.settle();
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ endpoint: ENDPOINT, method: "POST" });
    expect(JSON.parse(queued[0]?.body ?? "{}").request.uri).toBe("/");

    accept = () => {
      throw new TypeError("unreachable");
    };
    await t.request("/");
    await t.settle();
    expect(queued).toHaveLength(2);
  });

  it("does not queue a delivery that succeeded, and drops failures without a queue", async () => {
    const queued: HttpLogDelivery[] = [];
    const ok = app({}, queued);
    await ok.request("/");
    await ok.settle();
    expect(queued).toHaveLength(0);

    accept = () => false;
    const noQueue = app();
    const res = await noQueue.request("/");
    await noQueue.settle();
    expect(res.status).toBe(200);
  });

  it("queues the entry when the gateway supplied no transport", async () => {
    const queued: HttpLogDelivery[] = [];
    const t = testApp(
      httpLog,
      { http_endpoint: ENDPOINT },
      {
        plugins: [
          {
            id: "queue",
            name: "queue",
            priority: Number.MAX_SAFE_INTEGER,
            scope: {},
            handlers: {
              access: async (c, next) => {
                setHttpLogQueue(c, { send: async (d) => void queued.push(d) });
                await next();
              },
            },
          },
        ],
      },
    );
    await t.request("/");
    await t.settle();
    expect(sent).toHaveLength(0);
    expect(queued).toHaveLength(1);
  });

  it("is also plain Hono middleware", async () => {
    const plain = new Hono();
    plain.use(async (c, next) => {
      setHttpLogTransport(c, transport);
      await next();
    });
    plain.use(httpLog.middleware({ http_endpoint: ENDPOINT }));
    plain.get("/", (c) => c.text("ok"));
    const ctx = createExecutionContext();
    const res = await plain.fetch(new Request("https://x.test/"), {}, ctx);
    await waitOnExecutionContext(ctx);
    expect(await res.text()).toBe("ok");
    expect(sent).toHaveLength(1);
  });
});
