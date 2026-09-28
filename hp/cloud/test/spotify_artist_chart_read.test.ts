import { describe, expect, it, vi } from "vitest";
import { spotifyArtistChartHistoryResponse } from "../src/spotify_artist_chart_read";
import type { Env } from "../src/sources";

const PREFIX = "spotify/charts/artist-jp-daily/";

function document(chartDate: string, sakuraRank: number, nogiRank: number): string {
  return JSON.stringify({
    version: 1,
    chart_id: "artist-jp-daily",
    chart_date: chartDate,
    observed_at: Date.parse(`${chartDate}T22:20:00Z`),
    received_at: Date.parse(`${chartDate}T22:21:00Z`),
    entry_count: 100,
    entries: [
      { rank: sakuraRank, artist_name: "櫻坂46", artist_id: "artist-sakura-00000001" },
      { rank: nogiRank, artist_name: "乃木坂46", artist_id: "artist-nogi-0000000001" },
      { rank: 99, artist_name: "Other Artist", artist_id: "artist-other-00000001" },
    ],
  });
}

function bucketHarness() {
  const bodies = new Map<string, string>([
    [`${PREFIX}2026-09-26.json`, document("2026-09-26", 18, 10)],
    [`${PREFIX}2026-09-27.json`, document("2026-09-27", 16, 9)],
    [`${PREFIX}latest.json`, document("2026-09-27", 16, 9)],
  ]);
  const get = vi.fn(async (key: string) => {
    const body = bodies.get(key);
    return body == null ? null : { text: async () => body };
  });
  const list = vi.fn(async () => ({
    objects: [...bodies.keys()].map((key) => ({ key })),
    truncated: false,
  }));
  return {
    get,
    list,
    bucket: { get, list } as unknown as R2Bucket,
  };
}

describe("Spotify Japan daily artist chart history reader", () => {
  it("returns stored R2 history and filters it to requested artists", async () => {
    const harness = bucketHarness();
    const env = { DB: {} as D1Database, DATA_BUCKET: harness.bucket } as Env;
    const response = await spotifyArtistChartHistoryResponse(
      new Request("https://example.test/api/spotify-artist-chart?days=2&artist=%E6%AB%BB%E5%9D%8246"),
      env,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    const payload = await response.json() as {
      ok: boolean;
      chart_id: string;
      latest_chart_date: string;
      latest_entry_count: number;
      requested_artists: string[];
      days: Array<{ chart_date: string; entries: Array<{ rank: number; artist_name: string }> }>;
    };
    expect(payload.ok).toBe(true);
    expect(payload.chart_id).toBe("artist-jp-daily");
    expect(payload.latest_chart_date).toBe("2026-09-27");
    expect(payload.latest_entry_count).toBe(100);
    expect(payload.requested_artists).toEqual(["櫻坂46"]);
    expect(payload.days.map((day) => [day.chart_date, day.entries[0]?.rank])).toEqual([
      ["2026-09-26", 18],
      ["2026-09-27", 16],
    ]);
    expect(payload.days.every((day) => day.entries.length === 1)).toBe(true);
    expect(harness.get).toHaveBeenCalledWith(`${PREFIX}latest.json`);
  });

  it("reports a missing R2 binding without exposing another storage path", async () => {
    const response = await spotifyArtistChartHistoryResponse(
      new Request("https://example.test/api/spotify-artist-chart"),
      { DB: {} as D1Database } as Env,
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: "Spotify artist chart storage unavailable",
    });
  });
});
