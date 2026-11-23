import { HEADER } from "@edgway/constants";
import type { LogRecord } from "@logtape/logtape";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import {
  ATTR_EDGWAY_REQUEST_ID,
  ATTR_HTTP_REQUEST_METHOD,
  configureLogging,
  EVENT,
  getLogger,
  requestIdMiddleware,
} from "./index.js";

describe("@edgway/telemetry", () => {
  it("uses OpenTelemetry semantic-convention names", () => {
    expect(ATTR_HTTP_REQUEST_METHOD).toBe("http.request.method");
    expect(ATTR_EDGWAY_REQUEST_ID).toBe("edgway.request.id");
  });

  it("logs structured records under the edgway category", () => {
    const records: LogRecord[] = [];
    configureLogging({ sink: (record) => records.push(record) });
    getLogger("gateway").error(EVENT.unhandledError, {
      [ATTR_HTTP_REQUEST_METHOD]: "GET",
    });
    expect(records).toHaveLength(1);
    expect(records[0]?.category).toEqual(["edgway", "gateway"]);
    expect(records[0]?.level).toBe("error");
    expect(records[0]?.properties).toMatchObject({
      "http.request.method": "GET",
    });
  });

  it("sets the request-id header, reusing an incoming one", async () => {
    const app = new Hono();
    app.use("*", requestIdMiddleware());
    app.get("/", (c) => c.text(c.get("requestId")));
    const fresh = await app.request("/");
    expect(fresh.headers.get(HEADER.requestId)).toBe(await fresh.text());
    const reused = await app.request("/", {
      headers: { [HEADER.requestId]: "abc-123" },
    });
    expect(reused.headers.get(HEADER.requestId)).toBe("abc-123");
  });
});
