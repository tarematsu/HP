import { afterEach, describe, expect, it, vi } from "vitest";
import { applySpotifyArtistChartInput } from "../src/spotify_artist_chart_capture";
import type { Env } from "../src/sources";

const NOW = Date.UTC(2026, 8, 28, 0, 30, 0);

function entries(count = 100): Array<Record<string, unknown>> {
  return Array.from({ length: count }, (_, index) => {
    const rank = index + 1;
    return {
      rank,
      artist_name: `Artist ${rank}`,
      artist_id: `A${String(rank).padStart(21, "0")}`,
      previous_rank: rank,
      peak_rank: 1,
      streak: rank,
    };
  });
}

function capture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: 1,
    observed_at: NOW - 60_000,
    source: "spotify-charts-webview",
    chart_id: "artist-jp-daily",
    chart_date: "2026-09-27",
    entry_count: 100,
    entries: entries(),
    ...overrides,
  };
}

function bucketHarness() {
  const bodies = new Map<string, string>();
  const metadata = new Map<string, Record<string, string>>();
  const put = vi.fn(async (key: string, body: string, options?: R2PutOptions) => {
    bodies.set(key, String(body));
    metadata.set(key, { ...(options?.customMetadata ?? {}) });
    return {};
  });
  const head = vi.fn(async (key: string) => {
    const customMetadata = metadata.get(key);
    return customMetadata ? { customMetadata } : null;
  });
  return {
    bodies,
    metadata,
    put,
    head,
    bucket: { put, head } as unknown as R2Bucket,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Spotify Japan daily artist chart capture", () => {
  it("stores a dated snapshot and advances latest with normalized chart data", async () => {
    const harness = bucketHarness();
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const env = { DB: {} as D1Database, DATA_BUCKET: harness.bucket } as Env;

    const result = await applySpotifyArtistChartInput([capture()], env);

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      accepted: 1,
      stored: true,
      reported: true,
      chartDate: "2026-09-27",
      latestUpdated: true,
    });
    const dated = "spotify/charts/artist-jp-daily/2026-09-27.json";
    const latest = "spotify/charts/artist-jp-daily/latest.json";
    expect(harness.put).toHaveBeenCalledTimes(2);
    expect(harness.bodies.has(dated)).toBe(true);
    expect(harness.bodies.has(latest)).toBe(true);
    const stored = JSON.parse(harness.bodies.get(latest) ?? "{}") as Record<string, unknown>;
    expect(stored).toMatchObject({ version: 1, chart_id: "artist-jp-daily", entry_count: 100 });
    expect(JSON.stringify(stored)).not.toMatch(/authorization|bearer|cookie|token/i);
    expect(harness.metadata.get(latest)).toMatchObject({
      chartId: "artist-jp-daily",
      chartDate: "2026-09-27",
      observedAt: String(NOW - 60_000),
    });
  });

  it("does not let an older retry overwrite a newer dated snapshot or latest", async () => {
    const harness = bucketHarness();
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const env = { DB: {} as D1Database, DATA_BUCKET: harness.bucket } as Env;

    await applySpotifyArtistChartInput([capture()], env);
    harness.put.mockClear();
    const older = capture({ observed_at: NOW - 120_000 });
    const result = await applySpotifyArtistChartInput([older], env);

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ stored: false, latestUpdated: false });
    expect(harness.put).not.toHaveBeenCalled();
  });

  it("accepts an older chart date for history without rolling latest backwards", async () => {
    const harness = bucketHarness();
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const env = { DB: {} as D1Database, DATA_BUCKET: harness.bucket } as Env;

    await applySpotifyArtistChartInput([capture()], env);
    harness.put.mockClear();
    const result = await applySpotifyArtistChartInput([
      capture({ chart_date: "2026-09-26", observed_at: NOW - 30_000 }),
    ], env);

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ stored: true, latestUpdated: false });
    expect(harness.put).toHaveBeenCalledTimes(1);
    expect(harness.bodies.has("spotify/charts/artist-jp-daily/2026-09-26.json")).toBe(true);
    const latest = JSON.parse(
      harness.bodies.get("spotify/charts/artist-jp-daily/latest.json") ?? "{}",
    ) as Record<string, unknown>;
    expect(latest.chart_date).toBe("2026-09-27");
  });

  it("rejects malformed rankings before writing R2", async () => {
    const harness = bucketHarness();
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const env = { DB: {} as D1Database, DATA_BUCKET: harness.bucket } as Env;
    const duplicateRanks = entries();
    duplicateRanks[1] = { ...duplicateRanks[1], rank: 1 };

    const result = await applySpotifyArtistChartInput([
      capture({ entries: duplicateRanks }),
    ], env);

    expect(result.status).toBe(400);
    expect(harness.put).not.toHaveBeenCalled();
  });
});
