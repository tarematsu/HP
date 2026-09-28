import type { Env } from "./sources";
import { syncSpotifyArtistChartR2ToD1 } from "./spotify_artist_chart_read";

const MAX_RECORDS = 4;
const MAX_ENTRIES = 200;
const MIN_ENTRIES = 50;
const MAX_ARTIST_NAME = 240;
const CHART_ID = "artist-jp-daily";
const PREFIX = "spotify/charts/artist-jp-daily/";
const LATEST_KEY = `${PREFIX}latest.json`;
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const ARTIST_ID = /^[A-Za-z0-9]{10,80}$/;
const ENCODER = new TextEncoder();

export interface SpotifyArtistChartEntry {
  rank: number;
  artist_name: string;
  artist_id?: string;
  previous_rank?: number;
  peak_rank?: number;
  streak?: number;
}

export interface SpotifyArtistChartCapture {
  schema: 1;
  observed_at: number;
  source: "spotify-charts-webview";
  chart_id: typeof CHART_ID;
  chart_date: string;
  entry_count: number;
  entries: SpotifyArtistChartEntry[];
}

export interface SpotifyArtistChartInputResult {
  status: number;
  body: Record<string, unknown>;
}

function integerInRange(value: unknown, minimum: number, maximum: number): number | null {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= minimum && number <= maximum ? number : null;
}

function optionalIntegerInRange(
  value: unknown,
  minimum: number,
  maximum: number,
): number | undefined | null {
  if (value === undefined || value === null || value === "") return undefined;
  return integerInRange(value, minimum, maximum);
}

function validChartDate(value: unknown, now: number): string | null {
  const chartDate = String(value ?? "").trim();
  if (!DATE_KEY.test(chartDate)) return null;
  const parsed = Date.parse(`${chartDate}T00:00:00Z`);
  if (!Number.isFinite(parsed)) return null;
  const age = now - parsed;
  if (age < -2 * 86_400_000 || age > 14 * 86_400_000) return null;
  return chartDate;
}

function normalizeEntry(value: unknown): SpotifyArtistChartEntry | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const rank = integerInRange(input.rank, 1, MAX_ENTRIES);
  if (rank === null) return null;
  const artistName = String(input.artist_name ?? "").trim().slice(0, MAX_ARTIST_NAME);
  if (!artistName) return null;

  const artistIdRaw = String(input.artist_id ?? "").trim();
  if (artistIdRaw && !ARTIST_ID.test(artistIdRaw)) return null;
  const previousRank = optionalIntegerInRange(input.previous_rank, 1, MAX_ENTRIES);
  const peakRank = optionalIntegerInRange(input.peak_rank, 1, MAX_ENTRIES);
  const streak = optionalIntegerInRange(input.streak, 0, 100_000);
  if (previousRank === null || peakRank === null || streak === null) return null;

  const output: SpotifyArtistChartEntry = { rank, artist_name: artistName };
  if (artistIdRaw) output.artist_id = artistIdRaw;
  if (previousRank !== undefined) output.previous_rank = previousRank;
  if (peakRank !== undefined) output.peak_rank = peakRank;
  if (streak !== undefined) output.streak = streak;
  return output;
}

function normalizeCapture(value: unknown, now: number): SpotifyArtistChartCapture | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (Number(input.schema) !== 1 || input.source !== "spotify-charts-webview" || input.chart_id !== CHART_ID) {
    return null;
  }
  const observedAt = Number(input.observed_at);
  if (!Number.isSafeInteger(observedAt) ||
      observedAt < now - 14 * 86_400_000 || observedAt > now + 86_400_000) {
    return null;
  }
  const chartDate = validChartDate(input.chart_date, now);
  if (!chartDate || !Array.isArray(input.entries) ||
      input.entries.length < MIN_ENTRIES || input.entries.length > MAX_ENTRIES) {
    return null;
  }

  const entries: SpotifyArtistChartEntry[] = [];
  const ranks = new Set<number>();
  for (const raw of input.entries) {
    const entry = normalizeEntry(raw);
    if (!entry || ranks.has(entry.rank)) return null;
    ranks.add(entry.rank);
    entries.push(entry);
  }
  entries.sort((left, right) => left.rank - right.rank);
  if (entries.length < MIN_ENTRIES || entries[0]?.rank !== 1) return null;

  return {
    schema: 1,
    observed_at: observedAt,
    source: "spotify-charts-webview",
    chart_id: CHART_ID,
    chart_date: chartDate,
    entry_count: entries.length,
    entries,
  };
}

function normalizedBatch(value: unknown, now: number): SpotifyArtistChartCapture[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_RECORDS) return null;
  const byDate = new Map<string, SpotifyArtistChartCapture>();
  for (const raw of value) {
    const capture = normalizeCapture(raw, now);
    if (!capture) return null;
    const current = byDate.get(capture.chart_date);
    if (!current || capture.observed_at > current.observed_at) byDate.set(capture.chart_date, capture);
  }
  return [...byDate.values()].sort((left, right) => left.chart_date.localeCompare(right.chart_date));
}

type StoredGeneration = {
  chart_date: string;
  observed_at: number;
  content_digest?: string;
};

async function storedGeneration(env: Env, key: string): Promise<StoredGeneration | null> {
  if (!env.DATA_BUCKET) return null;
  const object = await env.DATA_BUCKET.head(key);
  if (!object) return null;
  const chartDate = String(object.customMetadata?.chartDate ?? "");
  const observedAt = Number(object.customMetadata?.observedAt ?? "");
  if (!DATE_KEY.test(chartDate) || !Number.isSafeInteger(observedAt)) return null;
  const contentDigest = String(object.customMetadata?.contentDigest ?? "").trim();
  return {
    chart_date: chartDate,
    observed_at: observedAt,
    ...(contentDigest ? { content_digest: contentDigest } : {}),
  };
}

function isNewerOrEqual(capture: SpotifyArtistChartCapture, previous: StoredGeneration | null): boolean {
  return !previous
    || capture.chart_date > previous.chart_date
    || (capture.chart_date === previous.chart_date && capture.observed_at >= previous.observed_at);
}

async function captureContentDigest(capture: SpotifyArtistChartCapture): Promise<string> {
  const canonical = JSON.stringify({
    chart_id: CHART_ID,
    chart_date: capture.chart_date,
    entries: capture.entries,
  });
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", ENCODER.encode(canonical)));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

function shouldWrite(
  capture: SpotifyArtistChartCapture,
  contentDigest: string,
  previous: StoredGeneration | null,
): boolean {
  if (!isNewerOrEqual(capture, previous)) return false;
  return !previous
    || previous.chart_date !== capture.chart_date
    || previous.content_digest !== contentDigest;
}

function storedDocument(capture: SpotifyArtistChartCapture, receivedAt: number): string {
  return JSON.stringify({
    version: 1,
    chart_id: CHART_ID,
    chart_date: capture.chart_date,
    observed_at: capture.observed_at,
    received_at: receivedAt,
    entry_count: capture.entries.length,
    entries: capture.entries,
  });
}

function metadata(capture: SpotifyArtistChartCapture, contentDigest: string): R2PutOptions {
  return {
    httpMetadata: { contentType: "application/json; charset=utf-8" },
    customMetadata: {
      chartId: CHART_ID,
      chartDate: capture.chart_date,
      observedAt: String(capture.observed_at),
      contentDigest,
    },
  };
}

export async function applySpotifyArtistChartInput(
  value: unknown,
  env: Env,
): Promise<SpotifyArtistChartInputResult> {
  if (!env.DATA_BUCKET) {
    return { status: 503, body: { error: "Spotify artist chart storage unavailable" } };
  }
  const receivedAt = Date.now();
  const captures = normalizedBatch(value, receivedAt);
  if (!captures) {
    return { status: 400, body: { error: "invalid Spotify artist chart capture" } };
  }

  let stored = false;
  let deduplicated = 0;
  const digests = new Map<string, string>();
  for (const capture of captures) {
    const contentDigest = await captureContentDigest(capture);
    digests.set(capture.chart_date, contentDigest);
    const dateKey = `${PREFIX}${capture.chart_date}.json`;
    const previousDate = await storedGeneration(env, dateKey);
    if (!shouldWrite(capture, contentDigest, previousDate)) {
      if (previousDate?.chart_date === capture.chart_date &&
          previousDate.content_digest === contentDigest) {
        deduplicated += 1;
      }
      continue;
    }
    await env.DATA_BUCKET.put(
      dateKey,
      storedDocument(capture, receivedAt),
      metadata(capture, contentDigest),
    );
    stored = true;
  }

  const newest = captures[captures.length - 1]!;
  const newestDigest = digests.get(newest.chart_date) ?? await captureContentDigest(newest);
  const previousLatest = await storedGeneration(env, LATEST_KEY);
  const canAdvanceLatest = shouldWrite(newest, newestDigest, previousLatest);
  if (canAdvanceLatest) {
    await env.DATA_BUCKET.put(
      LATEST_KEY,
      storedDocument(newest, receivedAt),
      metadata(newest, newestDigest),
    );
    stored = true;
  }

  let d1Sync: Awaited<ReturnType<typeof syncSpotifyArtistChartR2ToD1>> | null = null;
  try {
    d1Sync = await syncSpotifyArtistChartR2ToD1(
      env,
      captures.map((capture) => capture.chart_date),
    );
  } catch (error) {
    console.error("spotify-artist-chart-d1-sync-failed", {
      error: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300),
    });
  }

  return {
    status: 200,
    body: {
      accepted: Array.isArray(value) ? value.length : captures.length,
      stored,
      deduplicated,
      reported: true,
      chartDate: newest.chart_date,
      latestUpdated: canAdvanceLatest,
      d1Synced: d1Sync?.synced === true,
      d1Backfilled: d1Sync?.backfilled === true,
      d1Days: d1Sync?.days ?? 0,
      d1Rows: d1Sync?.rows ?? 0,
      delivery: "r2-d1-read-model",
    },
  };
}
