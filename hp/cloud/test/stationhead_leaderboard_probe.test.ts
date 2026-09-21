import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyStationheadLeaderboardProbeInput,
  normalizeStationheadLeaderboardProbe,
} from "../src/stationhead_leaderboard_probe";
import type { Env } from "../src/sources";

const NOW = Date.UTC(2026, 8, 22, 4, 0, 0);

function sample(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    observed_at: NOW - 1000,
    source: "fetch",
    page: "https://www.stationhead.com/leaderboard?homepanel_probe=1",
    url: "https://production1.stationhead.com/leaderboard/weekly?token=private&week=current",
    method: "GET",
    status: 200,
    content_type: "application/json",
    body: JSON.stringify({
      ranking: [{ rank: 1, name: "buddies", listens: 1234 }],
      authorization: "Bearer secret-token",
      nested: { device_uid: "private-device", keep: "ok" },
    }),
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Stationhead leaderboard probe", () => {
  it("keeps leaderboard data while redacting credentials and secret query values", () => {
    const normalized = normalizeStationheadLeaderboardProbe([sample()], NOW);
    expect(normalized).toHaveLength(1);
    const record = normalized![0];
    expect(record.url).toContain("week=current");
    expect(record.url).toContain("token=%5Bredacted%5D");
    expect(record.body).toContain('"rank":1');
    expect(record.body).toContain('"keep":"ok"');
    expect(record.body).toContain('"authorization":"[redacted]"');
    expect(record.body).toContain('"device_uid":"[redacted]"');
    expect(record.body).not.toContain("secret-token");
    expect(record.body).not.toContain("private-device");
  });

  it("rejects non-Stationhead destinations and oversized batches", () => {
    expect(normalizeStationheadLeaderboardProbe([
      sample({ url: "https://example.com/leaderboard" }),
    ], NOW)).toBeNull();
    expect(normalizeStationheadLeaderboardProbe(
      Array.from({ length: 9 }, () => sample()),
      NOW,
    )).toBeNull();
  });

  it("writes redacted R2 history and dispatches only the bounded safe report", async () => {
    const puts: Array<{ key: string; body: string }> = [];
    const put = vi.fn(async (key: string, body: string) => {
      puts.push({ key, body });
      return {};
    });
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const dispatch = JSON.parse(String(init?.body ?? "{}"));
      expect(dispatch.event_type).toBe("stationhead-leaderboard-probe");
      expect(dispatch.client_payload.body).toContain('"rank":1');
      expect(dispatch.client_payload.body).not.toContain("secret-token");
      expect(dispatch.client_payload.body).not.toContain("private-device");
      return new Response(null, { status: 204 });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(Date, "now").mockReturnValue(NOW);

    const env = {
      DB: {} as D1Database,
      DATA_BUCKET: { put } as unknown as R2Bucket,
      GITHUB_RADAR_DISPATCH_TOKEN: "github-test-token",
    } as Env;

    const result = await applyStationheadLeaderboardProbeInput(
      [sample()],
      env,
      "homepanel-device",
    );

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ accepted: 1, stored: true, reported: true });
    expect(put).toHaveBeenCalledTimes(2);
    expect(puts.some(item => item.key === "diagnostics/stationhead-leaderboard/latest.json")).toBe(true);
    expect(puts.some(item => item.key.startsWith("diagnostics/stationhead-leaderboard/history/"))).toBe(true);
    for (const item of puts) {
      expect(item.body).toContain('"rank":1');
      expect(item.body).not.toContain("secret-token");
      expect(item.body).not.toContain("private-device");
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
