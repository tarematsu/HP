import { describe, expect, it, vi } from "vitest";
import {
  spotifyArtistChartHistoryResponse,
  syncSpotifyArtistChartR2ToD1,
} from "../src/spotify_artist_chart_read";
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
      { rank: sakuraRank, artist_name: "櫻坂46", artist_id: "artist-sakura-00000001", previous_rank: sakuraRank + 1, peak_rank: 8, streak: 12 },
      { rank: nogiRank, artist_name: "乃木坂46", artist_id: "artist-nogi-0000000001", previous_rank: nogiRank, peak_rank: 4, streak: 20 },
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

type StoredRow = Record<string, unknown>;

function d1Harness() {
  const roster = [
    { artist_key: "sakurazaka46", spotify_artist_id: "artist-sakura-00000001", artist_name: "櫻坂46" },
    { artist_key: "nogizaka46", spotify_artist_id: "artist-nogi-0000000001", artist_name: "乃木坂46" },
  ];
  const rows = new Map<string, StoredRow>();
  const state: StoredRow = {
    backfill_completed: 0,
    latest_chart_date: null,
    latest_observed_at: null,
  };
  const batch = vi.fn(async (statements: Array<{ execute: () => void }>) => {
    for (const statement of statements) statement.execute();
    return statements.map(() => ({ success: true }));
  });

  const prepare = vi.fn((sql: string) => {
    let bindings: unknown[] = [];
    const statement = {
      bind(...values: unknown[]) {
        bindings = values;
        return statement;
      },
      async all() {
        if (/FROM sh_spotify_artists/.test(sql)) return { results: roster };
        if (/WITH selected_dates AS/.test(sql)) {
          const limit = Number(bindings[0]) || 90;
          const dates = [...new Set([...rows.values()].map((row) => String(row.chart_date)))].sort().slice(-limit);
          return {
            results: [...rows.values()]
              .filter((row) => dates.includes(String(row.chart_date)))
              .sort((left, right) => String(left.chart_date).localeCompare(String(right.chart_date))
                || Number(left.rank) - Number(right.rank)),
          };
        }
        throw new Error(`unexpected all SQL: ${sql}`);
      },
      async first() {
        if (/FROM sh_spotify_artist_chart_sync_state/.test(sql)) return { ...state };
        throw new Error(`unexpected first SQL: ${sql}`);
      },
      async run() {
        if (/INSERT INTO sh_spotify_artist_chart_sync_state/.test(sql)) {
          state.backfill_completed = bindings[0];
          state.latest_chart_date = bindings[1];
          state.latest_observed_at = bindings[2];
          state.updated_at = bindings[3];
          return { success: true };
        }
        throw new Error(`unexpected run SQL: ${sql}`);
      },
      execute() {
        if (/DELETE FROM sh_spotify_artist_chart_daily/.test(sql)) {
          const chartDate = String(bindings[0]);
          for (const [key, row] of rows) {
            if (row.chart_date === chartDate) rows.delete(key);
          }
          return;
        }
        if (/INSERT INTO sh_spotify_artist_chart_daily/.test(sql)) {
          const [
            chart_date,
            artist_key,
            spotify_artist_id,
            artist_name,
            rank,
            previous_rank,
            peak_rank,
            streak,
            observed_at,
            received_at,
            updated_at,
          ] = bindings;
          rows.set(`${chart_date}:${artist_key}`, {
            chart_date,
            artist_key,
            spotify_artist_id,
            artist_name,
            rank,
            previous_rank,
            peak_rank,
            streak,
            observed_at,
            received_at,
            updated_at,
          });
          return;
        }
        throw new Error(`unexpected batch SQL: ${sql}`);
      },
    };
    return statement;
  });

  return {
    rows,
    state,
    batch,
    prepare,
    db: { prepare, batch } as unknown as D1Database,
  };
}

describe("Spotify Japan daily artist chart R2 to D1 normalization", () => {
  it("backfills R2 history and persists only tracked female-idol artists", async () => {
    const bucket = bucketHarness();
    const d1 = d1Harness();
    const env = {
      DB: {} as D1Database,
      DATA_BUCKET: bucket.bucket,
      OTHER_DB: d1.db,
    } as Env & { OTHER_DB: D1Database };

    const result = await syncSpotifyArtistChartR2ToD1(env);

    expect(result).toMatchObject({
      synced: true,
      backfilled: true,
      days: 2,
      rows: 4,
      latest_chart_date: "2026-09-27",
    });
    expect([...d1.rows.values()].map((row) => [row.chart_date, row.artist_key, row.rank])).toEqual([
      ["2026-09-26", "sakurazaka46", 18],
      ["2026-09-26", "nogizaka46", 10],
      ["2026-09-27", "sakurazaka46", 16],
      ["2026-09-27", "nogizaka46", 9],
    ]);
    expect([...d1.rows.values()].some((row) => row.artist_name === "Other Artist")).toBe(false);
    expect(d1.state.backfill_completed).toBe(1);
    expect(d1.state.latest_chart_date).toBe("2026-09-27");
  });

  it("skips R2 history rewrites after the initial backfill and serves D1 history", async () => {
    const bucket = bucketHarness();
    const d1 = d1Harness();
    const env = {
      DB: {} as D1Database,
      DATA_BUCKET: bucket.bucket,
      OTHER_DB: d1.db,
    } as Env & { OTHER_DB: D1Database };

    await syncSpotifyArtistChartR2ToD1(env);
    bucket.list.mockClear();
    d1.batch.mockClear();

    const second = await syncSpotifyArtistChartR2ToD1(env);
    expect(second).toMatchObject({ synced: true, backfilled: false, days: 0, rows: 0 });
    expect(bucket.list).not.toHaveBeenCalled();
    expect(d1.batch).not.toHaveBeenCalled();

    const response = await spotifyArtistChartHistoryResponse(
      new Request("https://example.test/api/spotify-artist-chart?days=2&artist=%E6%AB%BB%E5%9D%8246"),
      env,
    );
    expect(response.status).toBe(200);
    const payload = await response.json() as {
      ok: boolean;
      chart_id: string;
      latest_chart_date: string;
      read_path: string;
      days: Array<{ chart_date: string; entries: Array<{ rank: number; artist_name: string }> }>;
    };
    expect(payload).toMatchObject({
      ok: true,
      chart_id: "artist-jp-daily",
      latest_chart_date: "2026-09-27",
      read_path: "d1-normalized",
    });
    expect(payload.days.map((day) => [day.chart_date, day.entries[0]?.rank])).toEqual([
      ["2026-09-26", 18],
      ["2026-09-27", 16],
    ]);
    expect(payload.days.every((day) => day.entries.length === 1)).toBe(true);
  });

  it("reports a missing stationhead D1 binding", async () => {
    const response = await spotifyArtistChartHistoryResponse(
      new Request("https://example.test/api/spotify-artist-chart"),
      { DB: {} as D1Database, DATA_BUCKET: bucketHarness().bucket } as Env,
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: "Spotify artist chart D1 storage unavailable",
    });
  });
});
