import { afterEach, describe, expect, it, vi } from "vitest";
import { applyStationheadLeaderboardProbeInput } from "../src/stationhead_leaderboard_probe";
import type { Env } from "../src/sources";

const MONDAY_BEFORE_WINDOW = Date.UTC(2026, 8, 21, 8, 30, 0);
const MONDAY_WINDOW = Date.UTC(2026, 8, 21, 9, 0, 0);
const NOW = Date.UTC(2026, 8, 21, 9, 1, 0);

function body(capturedAt: number) {
  return JSON.stringify({
    schema: 2,
    captured_at: capturedAt,
    path: "/leaderboard",
    signed_in: true,
    leaderboard_ready: true,
    leaderboard: Array.from({ length: 100 }, (_, index) => ({
      rank: index + 1,
      host: `host${index + 1}`,
    })),
  });
}

function sample(observedAt: number) {
  return [{
    observed_at: observedAt,
    source: "dedicated-webview-dom",
    page: "https://www.stationhead.com/leaderboard",
    url: "https://www.stationhead.com/leaderboard",
    method: "GET",
    status: 200,
    content_type: "application/json",
    body: body(observedAt),
  }];
}

afterEach(() => vi.restoreAllMocks());

describe("Stationhead weekly candidate seeding", () => {
  it("creates the Monday weekly object even when leaderboard content did not change at the window boundary", async () => {
    const metadata = new Map<string, string>();
    const payloads = new Map<string, string>();
    const put = vi.fn(async (key: string, value: string, options?: R2PutOptions) => {
      payloads.set(key, value);
      const digest = options?.customMetadata?.contentDigest;
      if (digest) metadata.set(key, digest);
      return {};
    });
    const head = vi.fn(async (key: string) => {
      const digest = metadata.get(key);
      return digest ? { customMetadata: { contentDigest: digest } } : null;
    });
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const env = { DB: {} as D1Database, DATA_BUCKET: { put, head } as unknown as R2Bucket } as Env;

    const first = await applyStationheadLeaderboardProbeInput(sample(MONDAY_BEFORE_WINDOW), env, "device");
    expect(first.body).toMatchObject({ stored: true, weeklyCandidate: null });
    expect([...payloads.keys()].some(key => key.includes("/weekly/"))).toBe(false);

    const second = await applyStationheadLeaderboardProbeInput(sample(MONDAY_WINDOW), env, "device");
    expect(second.body).toMatchObject({
      stored: false,
      unchanged: true,
      weeklyCandidate: "2026-09-21",
      weeklySeeded: true,
    });

    const weeklyKey = "diagnostics/stationhead-leaderboard/weekly/2026-09-21.json";
    const weekly = JSON.parse(payloads.get(weeklyKey) || "null");
    expect(weekly).toMatchObject({
      version: 1,
      ranking_date: "2026-09-21",
      observed_at: MONDAY_WINDOW,
      row_count: 100,
    });
    expect(weekly.rows[0]).toEqual({ rank: 1, channel_name: "host1" });
  });

  it("does not rewrite an unchanged weekly object that already carries the same digest", async () => {
    const metadata = new Map<string, string>();
    const put = vi.fn(async (key: string, _value: string, options?: R2PutOptions) => {
      const digest = options?.customMetadata?.contentDigest;
      if (digest) metadata.set(key, digest);
      return {};
    });
    const head = vi.fn(async (key: string) => {
      const digest = metadata.get(key);
      return digest ? { customMetadata: { contentDigest: digest } } : null;
    });
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const env = { DB: {} as D1Database, DATA_BUCKET: { put, head } as unknown as R2Bucket } as Env;

    await applyStationheadLeaderboardProbeInput(sample(MONDAY_WINDOW), env, "device");
    const firstPutCount = put.mock.calls.length;
    const result = await applyStationheadLeaderboardProbeInput(sample(MONDAY_WINDOW + 30 * 60_000), env, "device");
    expect(result.body).toMatchObject({ stored: false, unchanged: true, weeklySeeded: false });
    expect(put).toHaveBeenCalledTimes(firstPutCount);
  });
});
