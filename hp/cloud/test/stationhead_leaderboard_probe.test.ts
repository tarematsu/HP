import { afterEach, describe, expect, it, vi } from "vitest";
import { applyStationheadLeaderboardProbeInput, normalizeStationheadLeaderboardProbe } from "../src/stationhead_leaderboard_probe";
import type { Env } from "../src/sources";

const NOW = Date.UTC(2026, 8, 22, 4, 0, 0);
function sample(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { observed_at: NOW - 1000, source: "fetch", page: "https://www.stationhead.com/leaderboard?homepanel_probe=1", url: "https://production1.stationhead.com/leaderboard/weekly?token=private&week=current", method: "GET", status: 200, content_type: "application/json", body: JSON.stringify({ captured_at: NOW - 1000, ranking: [{ rank: 1, name: "buddies", listens: 1234 }], authorization: "Bearer secret-token", nested: { device_uid: "private-device", keep: "ok" } }), ...overrides };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("Stationhead leaderboard probe", () => {
  it("keeps leaderboard data while redacting credentials and secret query values", () => {
    const normalized = normalizeStationheadLeaderboardProbe([sample()], NOW);
    expect(normalized).toHaveLength(1); if (!normalized?.[0]) throw new Error("expected one normalized leaderboard record");
    const record = normalized[0]; expect(record.url).toContain("week=current"); expect(record.url).toContain("token=%5Bredacted%5D"); expect(record.body).toContain('"rank":1'); expect(record.body).toContain('"keep":"ok"'); expect(record.body).toContain('"authorization":"[redacted]"'); expect(record.body).toContain('"device_uid":"[redacted]"'); expect(record.body).not.toContain("secret-token"); expect(record.body).not.toContain("private-device");
  });

  it("rejects non-Stationhead destinations and oversized batches", () => {
    expect(normalizeStationheadLeaderboardProbe([sample({ url: "https://example.com/leaderboard" })], NOW)).toBeNull();
    expect(normalizeStationheadLeaderboardProbe(Array.from({ length: 9 }, () => sample()), NOW)).toBeNull();
  });

  it("skips all R2 writes when leaderboard content is unchanged", async () => {
    const puts: Array<{ key: string; body: string; options?: R2PutOptions }> = [];
    let latestDigest: string | undefined;
    const put = vi.fn(async (key: string, body: string, options?: R2PutOptions) => { puts.push({ key, body, options }); if (key.endsWith("latest.json")) latestDigest = options?.customMetadata?.contentDigest; return {}; });
    const head = vi.fn(async () => latestDigest ? ({ customMetadata: { contentDigest: latestDigest } }) : null);
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const env = { DB: {} as D1Database, DATA_BUCKET: { put, head } as unknown as R2Bucket } as Env;

    const first = await applyStationheadLeaderboardProbeInput([sample()], env, "homepanel-device");
    const second = await applyStationheadLeaderboardProbeInput([sample({ observed_at: NOW, body: JSON.stringify({ captured_at: NOW, ranking: [{ rank: 1, name: "buddies", listens: 1234 }], authorization: "Bearer another-secret", nested: { device_uid: "another-device", keep: "ok" } }) })], env, "homepanel-device");

    expect(first.body).toMatchObject({ stored: true, unchanged: false });
    expect(second.body).toMatchObject({ stored: false, unchanged: true });
    expect(second.body.historyKey).toBe(first.body.historyKey);
    expect(put).toHaveBeenCalledTimes(2);
    expect(head).toHaveBeenCalledTimes(2);
    expect(puts.filter(item => item.key.endsWith("latest.json"))).toHaveLength(1);
    expect(puts[0]?.options?.customMetadata?.contentDigest).toBeTruthy();
  });

  it("writes a new R2 snapshot when leaderboard content changes", async () => {
    let latestDigest: string | undefined;
    const put = vi.fn(async (key: string, _body: string, options?: R2PutOptions) => { if (key.endsWith("latest.json")) latestDigest = options?.customMetadata?.contentDigest; return {}; });
    const head = vi.fn(async () => latestDigest ? ({ customMetadata: { contentDigest: latestDigest } }) : null);
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const env = { DB: {} as D1Database, DATA_BUCKET: { put, head } as unknown as R2Bucket } as Env;
    await applyStationheadLeaderboardProbeInput([sample()], env, "homepanel-device");
    const changed = await applyStationheadLeaderboardProbeInput([sample({ body: JSON.stringify({ captured_at: NOW, ranking: [{ rank: 1, name: "buddies", listens: 1235 }] }) })], env, "homepanel-device");
    expect(changed.body).toMatchObject({ stored: true, unchanged: false });
    expect(put).toHaveBeenCalledTimes(4);
  });
});
