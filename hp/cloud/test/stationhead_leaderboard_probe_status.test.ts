import { describe, expect, it } from "vitest";
import {
  applyNativeLeaderboardProbeStatus,
  normalizeNativeLeaderboardProbeStatus,
  stationheadLeaderboardProbeStatusResponse,
  type LeaderboardProbeOutcome,
} from "../src/stationhead_leaderboard_probe_status";
import type { Env } from "../src/sources";

function outcome(overrides: Partial<LeaderboardProbeOutcome> = {}): LeaderboardProbeOutcome {
  return {
    submitted: false,
    accepted: 0,
    stored: false,
    reported: false,
    error: "none",
    ...overrides,
  };
}

function testEnv() {
  const objects = new Map<string, string>();
  const bucket = {
    async get(key: string) {
      const body = objects.get(key);
      return body === undefined ? null : { text: async () => body };
    },
    async put(key: string, value: string) {
      objects.set(key, String(value));
      return {};
    },
  } as unknown as R2Bucket;
  return {
    env: { DB: {} as D1Database, DATA_BUCKET: bucket } as Env,
    objects,
  };
}

describe("Stationhead leaderboard probe status", () => {
  it("accepts only bounded non-secret native counters", () => {
    expect(normalizeNativeLeaderboardProbeStatus({ spoolRecords: 3, batchRecords: 2 }))
      .toEqual({ spoolRecords: 3, batchRecords: 2 });
    expect(normalizeNativeLeaderboardProbeStatus({ spoolRecords: 21, batchRecords: 2 })).toBeNull();
    expect(normalizeNativeLeaderboardProbeStatus({ spoolRecords: 2, batchRecords: 3 })).toBeNull();
  });

  it("shows native spooled state before cloud probe submission", async () => {
    const { env } = testEnv();
    const result = await applyNativeLeaderboardProbeStatus(
      { spoolRecords: 2, batchRecords: 0 },
      env,
      outcome(),
    );
    expect(result.status).toBe(200);
    expect(result.body.stage).toBe("native_spooled");

    const response = await stationheadLeaderboardProbeStatusResponse(env);
    const body = await response.json() as Record<string, any>;
    expect(body.stage).toBe("native_spooled");
    expect(body.native).toEqual({ spool_records: 2, batch_records: 0 });
    expect(body.cloud.reached).toBe(true);
    expect(JSON.stringify(body)).not.toContain("device_id");
  });

  it("preserves report history after acknowledgement drains the spool", async () => {
    const { env } = testEnv();
    await applyNativeLeaderboardProbeStatus(
      { spoolRecords: 1, batchRecords: 1 },
      env,
      outcome({ submitted: true, accepted: 1, stored: true, reported: true }),
    );
    let response = await stationheadLeaderboardProbeStatusResponse(env);
    let body = await response.json() as Record<string, any>;
    expect(body.stage).toBe("reported_awaiting_ack");
    expect(body.history.last_probe_received_at).toBeTruthy();
    expect(body.history.last_stored_at).toBeTruthy();
    expect(body.history.last_reported_at).toBeTruthy();

    await applyNativeLeaderboardProbeStatus(
      { spoolRecords: 0, batchRecords: 0 },
      env,
      outcome(),
    );
    response = await stationheadLeaderboardProbeStatusResponse(env);
    body = await response.json() as Record<string, any>;
    expect(body.stage).toBe("idle_after_report");
    expect(body.history.last_reported_at).toBeTruthy();
  });

  it("returns a safe no-status document before the first native sync", async () => {
    const { env } = testEnv();
    const response = await stationheadLeaderboardProbeStatusResponse(env);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json() as Record<string, any>;
    expect(body.stage).toBe("no_status");
    expect(body.cloud.reached).toBe(false);
  });
});
