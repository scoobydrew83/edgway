import { ANALYTICS, AUTHORIZATION, HEADER } from "@edgway/constants";
import { ERR } from "@edgway/errors";
import { describe, expect, it } from "vitest";
import { analyticsSql, writeRequestMetric } from "../src/index";

describe("Analytics Engine", () => {
  it("writes one data point per request, or nothing without a binding", () => {
    const points: AnalyticsEngineDataPoint[] = [];
    const dataset = {
      writeDataPoint: (p?: AnalyticsEngineDataPoint) => points.push(p ?? {}),
    };
    const metric = { route: "r1", method: "GET", status: 200, durationMs: 3 };
    writeRequestMetric(dataset as AnalyticsEngineDataset, metric);
    writeRequestMetric(undefined, metric);
    expect(points).toEqual([
      { indexes: ["r1"], blobs: ["r1", "", "", "GET"], doubles: [200, 3] },
    ]);
  });

  it("queries the SQL API with the account's token", async () => {
    const seen: Request[] = [];
    const query = analyticsSql({
      accountId: "acc",
      apiToken: "tok",
      fetch: async (input, init) => {
        seen.push(new Request(input, init));
        return Response.json({ data: [{ requests: "4" }], rows: 1 });
      },
    });
    expect(await query("SELECT 1")).toEqual([{ requests: "4" }]);
    expect(seen[0]?.url).toBe(ANALYTICS.sqlApi("acc"));
    expect(seen[0]?.method).toBe("POST");
    expect(seen[0]?.headers.get(HEADER.authorization)).toBe(
      AUTHORIZATION.bearer("tok"),
    );
    expect(await seen[0]?.text()).toBe("SELECT 1");
  });

  it("fails with EDG-ADM-010 when the API refuses", async () => {
    const query = analyticsSql({
      accountId: "acc",
      apiToken: "bad",
      fetch: async () =>
        new Response("no", { status: ERR.AUTH_FORBIDDEN.status }),
    });
    await expect(query("SELECT 1")).rejects.toMatchObject({
      problemDetails: { status: ERR.ADMIN_ANALYTICS_FAILED.status },
    });
  });
});
