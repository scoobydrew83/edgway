/**
 * the gateway logs server errors (5xx) as structured LogTape records
 * and stays silent for expected client problems (4xx).
 */

import { exports } from "cloudflare:workers";
import { HEADER } from "@edgway/constants";
import { EVENT } from "@edgway/telemetry";
import { afterEach, describe, expect, it, vi } from "vitest";

const BASE = "https://gateway.test";

function captureLogs() {
  const lines: string[] = [];
  for (const method of ["debug", "info", "log", "warn", "error"] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    });
  }
  return () => lines.filter((line) => line.includes(EVENT.unhandledError));
}

afterEach(() => vi.restoreAllMocks());

describe("gateway error logging", () => {
  it("does not log expected 4xx problems", async () => {
    const logged = captureLogs();
    const res = await exports.default.fetch(
      new Request(`${BASE}/nothing/here`),
    );
    expect(res.status).toBe(404);
    expect(logged()).toHaveLength(0);
  });

  it("logs one structured record for a 5xx, with the request id", async () => {
    // The test snapshot has a /broken route with no service (vitest.config.ts).
    const logged = captureLogs();
    const res = await exports.default.fetch(
      new Request(`${BASE}/broken`, {
        headers: { [HEADER.requestId]: "req-t007" },
      }),
    );
    expect(res.status).toBe(502);
    const records = logged();
    expect(records).toHaveLength(1);
    const record = JSON.parse(records[0] ?? "{}") as Record<string, unknown>;
    expect(record).toMatchObject({
      level: "ERROR",
      message: EVENT.unhandledError,
      logger: "edgway.gateway",
    });
    expect(JSON.stringify(record)).toContain("req-t007");
    expect(JSON.stringify(record)).toContain("/broken");
  });
});
