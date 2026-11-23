import { describe, expect, it } from "vitest";
import {
  consumerUsageSql,
  overviewConsumersSql,
  overviewLatencySql,
  overviewRoutesSql,
  overviewSeriesSql,
  PLUGIN_COLUMNS,
  PLUGIN_DATASET,
  pluginDataPoint,
  REQUEST_COLUMNS,
  REQUEST_DATASET,
  requestDataPoint,
} from "./index.js";

describe("request metrics (Analytics Engine)", () => {
  it("keeps the positional layout the queries read", () => {
    expect(REQUEST_COLUMNS).toEqual({
      route: "blob1",
      service: "blob2",
      consumer: "blob3",
      method: "blob4",
      status: "double1",
      duration_ms: "double2",
    });
  });

  it("writes one data point per request, indexed by route", () => {
    expect(
      requestDataPoint({
        route: "r1",
        service: "s1",
        method: "GET",
        status: 200,
        durationMs: 12.5,
      }),
    ).toEqual({
      indexes: ["r1"],
      blobs: ["r1", "s1", "", "GET"],
      doubles: [200, 12.5],
    });
    // Unmatched requests have no route.
    expect(
      requestDataPoint({ method: "GET", status: 404, durationMs: 1 }).indexes,
    ).toEqual([""]);
  });

  it("queries the dataset with sampling weights and whole-number bounds", () => {
    const series = overviewSeriesSql(24.9);
    expect(series).toContain(`FROM ${REQUEST_DATASET}`);
    expect(series).toContain("INTERVAL '24' HOUR");
    expect(series).toContain("SUM(_sample_interval) AS requests");
    expect(series).toContain("double1 >= 500");
    const routes = overviewRoutesSql(24, 10);
    expect(routes).toContain("SELECT blob1 AS route");
    expect(routes).toContain("LIMIT 10");
  });
});

describe("plugin timing", () => {
  it("keeps its own dataset and positional layout", () => {
    expect(PLUGIN_DATASET).toBe("edgway_plugins");
    expect(PLUGIN_COLUMNS).toEqual({
      plugin: "blob1",
      phase: "blob2",
      outcome: "blob3",
      route: "blob4",
      plugin_id: "blob5",
      duration_ms: "double1",
    });
  });

  it("writes one data point per plugin per phase, indexed by plugin name", () => {
    expect(
      pluginDataPoint({
        plugin: "key-auth",
        pluginId: "p1",
        phase: "access",
        outcome: "ok",
        route: "r1",
        durationMs: 0.42,
      }),
    ).toEqual({
      indexes: ["key-auth"],
      blobs: ["key-auth", "access", "ok", "r1", "p1"],
      doubles: [0.42],
    });
  });
});

describe("overview and usage queries", () => {
  it("weights latency quantiles by sampling", () => {
    const sql = overviewLatencySql(24);
    expect(sql).toContain(
      "quantileExactWeighted(0.5)(double2, _sample_interval) AS p50_ms",
    );
    expect(sql).toContain(
      "quantileExactWeighted(0.99)(double2, _sample_interval) AS p99_ms",
    );
    expect(sql).toContain("FROM edgway_requests");
  });

  it("ranks consumers, leaving anonymous traffic out", () => {
    const sql = overviewConsumersSql(24, 10);
    expect(sql).toContain("blob3 AS consumer");
    expect(sql).toContain("blob3 != ''");
    expect(sql).toContain("LIMIT 10");
  });

  it("scopes usage to one consumer, and refuses anything but a UUID", () => {
    const id = "0190a5e2-7c1d-7b4e-9f00-112233445566";
    expect(consumerUsageSql(id, 7)).toContain(`blob3 = '${id}'`);
    expect(consumerUsageSql("x' OR '1'='1", 7)).toBeUndefined();
    expect(consumerUsageSql("", 7)).toBeUndefined();
  });
});
