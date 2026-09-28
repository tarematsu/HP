import type { Env } from "./sources";

const CHART_ID = "artist-jp-daily";
const PREFIX = "spotify/charts/artist-jp-daily/";
const LATEST_KEY = `${PREFIX}latest.json`;
const DATE_OBJECT = /^spotify\/charts\/artist-jp-daily\/(\d{4}-\d{2}-\d{2})\.json$/;
const DEFAULT_DAYS = 90;
const MAX_DAYS = 90;
const MAX_ARTISTS = 50;
const MAX_ARTIST_NAME = 240;

type ChartEnv = Env & { OTHER_DB?: D1Database };

interface StoredArtistChartEntry {
  rank: number;
  artist_name: string;
  artist_id?: string;
  previous_rank?: number;
  peak_rank?: number;
  streak?: number;
}

interface StoredArtistChartDocument {
  version: number;
  chart_id: string;
  chart_date: string;
  observed_at: number;
  received_at?: number;
  entry_count: number;
  entries: StoredArtistChartEntry[];
}

interface TrackedArtist {
  artist_key: string;
  spotify_artist_id: string;
  artist_name: string;
}

function responseHeaders(): HeadersInit {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "public, max-age=300, s-maxage=900, stale-while-revalidate=3600",
    "X-Content-Type-Options": "nosniff",
  };
}

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: responseHeaders() });
}

function boundedDays(value: string | null): number {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_DAYS;
  return Math.max(1, Math.min(MAX_DAYS, parsed));
}

function requestedArtists(url: URL): string[] {
  const output: string[] = [];
  const seen = new Set<string>();
  for (const raw of url.searchParams.getAll("artist")) {
    const name = String(raw || "").trim().slice(0, MAX_ARTIST_NAME);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    output.push(name);
    if (output.length >= MAX_ARTISTS) break;
  }
  return output;
}

function normalizedArtistName(value: unknown): string {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase("ja-JP")
    .replace(/\s+/gu, " ")
    .trim();
}

function optionalInteger(value: unknown, minimum: number, maximum: number): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= minimum && number <= maximum ? number : undefined;
}

function validDocument(value: unknown): StoredArtistChartDocument | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const document = value as Record<string, unknown>;
  if (Number(document.version) !== 1 || document.chart_id !== CHART_ID) return null;
  const chartDate = String(document.chart_date || "");
  const observedAt = Number(document.observed_at);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(chartDate)
      || !Number.isSafeInteger(observedAt)
      || !Array.isArray(document.entries)) return null;

  const entries: StoredArtistChartEntry[] = [];
  for (const raw of document.entries) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const entry = raw as Record<string, unknown>;
    const rank = Number(entry.rank);
    const artistName = String(entry.artist_name || "").trim();
    if (!Number.isSafeInteger(rank) || rank < 1 || rank > 200 || !artistName) continue;
    const output: StoredArtistChartEntry = { rank, artist_name: artistName };
    const artistId = String(entry.artist_id || "").trim();
    if (artistId) output.artist_id = artistId;
    const previousRank = optionalInteger(entry.previous_rank, 1, 200);
    const peakRank = optionalInteger(entry.peak_rank, 1, 200);
    const streak = optionalInteger(entry.streak, 0, 100_000);
    if (previousRank !== undefined) output.previous_rank = previousRank;
    if (peakRank !== undefined) output.peak_rank = peakRank;
    if (streak !== undefined) output.streak = streak;
    entries.push(output);
  }

  const receivedAt = Number(document.received_at);
  return {
    version: 1,
    chart_id: CHART_ID,
    chart_date: chartDate,
    observed_at: observedAt,
    ...(Number.isFinite(receivedAt) && receivedAt > 0 ? { received_at: receivedAt } : {}),
    entry_count: Number(document.entry_count) || entries.length,
    entries,
  };
}

async function readDocument(bucket: R2Bucket, key: string): Promise<StoredArtistChartDocument | null> {
  const object = await bucket.get(key);
  if (!object) return null;
  try {
    return validDocument(JSON.parse(await object.text()));
  } catch {
    return null;
  }
}

async function datedObjectKeys(bucket: R2Bucket): Promise<Array<{ key: string; date: string }>> {
  const objects: Array<{ key: string; date: string }> = [];
  let cursor: string | undefined;
  do {
    const listed = await bucket.list({ prefix: PREFIX, limit: 1000, ...(cursor ? { cursor } : {}) });
    for (const object of listed.objects) {
      const match = object.key.match(DATE_OBJECT);
      const date = match?.[1];
      if (date) objects.push({ key: object.key, date });
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
  return objects.sort((left, right) => left.date.localeCompare(right.date));
}

async function trackedArtists(db: D1Database): Promise<TrackedArtist[]> {
  const result = await db.prepare(`SELECT artist_key,spotify_artist_id,artist_name
    FROM sh_spotify_artists
    WHERE trim(COALESCE(spotify_artist_id,''))<>''
    ORDER BY artist_key`).all();
  return (Array.isArray(result?.results) ? result.results : []).map((row) => ({
    artist_key: String(row?.artist_key || "").trim(),
    spotify_artist_id: String(row?.spotify_artist_id || "").trim(),
    artist_name: String(row?.artist_name || "").trim(),
  })).filter((row) => row.artist_key && row.artist_name);
}

async function persistDocument(
  db: D1Database,
  document: StoredArtistChartDocument,
  roster: TrackedArtist[],
): Promise<number> {
  const byId = new Map(roster.map((artist) => [artist.spotify_artist_id, artist]));
  const byName = new Map(roster.map((artist) => [normalizedArtistName(artist.artist_name), artist]));
  const matched = new Map<string, { artist: TrackedArtist; entry: StoredArtistChartEntry }>();

  for (const entry of document.entries) {
    const artist = (entry.artist_id ? byId.get(entry.artist_id) : undefined)
      ?? byName.get(normalizedArtistName(entry.artist_name));
    if (!artist) continue;
    matched.set(artist.artist_key, { artist, entry });
  }

  const updatedAt = Date.now();
  const statements = [
    db.prepare(`DELETE FROM sh_spotify_artist_chart_daily WHERE chart_date=?`)
      .bind(document.chart_date),
  ];
  for (const { artist, entry } of matched.values()) {
    statements.push(db.prepare(`INSERT INTO sh_spotify_artist_chart_daily (
        chart_date,artist_key,spotify_artist_id,artist_name,rank,previous_rank,peak_rank,streak,
        observed_at,received_at,updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(
        document.chart_date,
        artist.artist_key,
        artist.spotify_artist_id,
        artist.artist_name,
        entry.rank,
        entry.previous_rank ?? null,
        entry.peak_rank ?? null,
        entry.streak ?? null,
        document.observed_at,
        document.received_at ?? null,
        updatedAt,
      ));
  }
  await db.batch(statements);
  return matched.size;
}

async function syncState(db: D1Database): Promise<Record<string, unknown>> {
  return await db.prepare(`SELECT backfill_completed,latest_chart_date,latest_observed_at
    FROM sh_spotify_artist_chart_sync_state WHERE id=1`).first() ?? {};
}

async function saveSyncState(
  db: D1Database,
  backfillCompleted: boolean,
  latest: StoredArtistChartDocument | null,
): Promise<void> {
  await db.prepare(`INSERT INTO sh_spotify_artist_chart_sync_state (
      id,backfill_completed,latest_chart_date,latest_observed_at,updated_at
    ) VALUES (1,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      backfill_completed=excluded.backfill_completed,
      latest_chart_date=excluded.latest_chart_date,
      latest_observed_at=excluded.latest_observed_at,
      updated_at=excluded.updated_at`)
    .bind(
      backfillCompleted ? 1 : 0,
      latest?.chart_date ?? null,
      latest?.observed_at ?? null,
      Date.now(),
    )
    .run();
}

export async function syncSpotifyArtistChartR2ToD1(
  env: Env,
  chartDates: string[] = [],
): Promise<{ synced: boolean; backfilled: boolean; days: number; rows: number; latest_chart_date: string | null }> {
  const bucket = env.DATA_BUCKET;
  const db = (env as ChartEnv).OTHER_DB;
  if (!bucket || !db) {
    return { synced: false, backfilled: false, days: 0, rows: 0, latest_chart_date: null };
  }

  const state = await syncState(db);
  const backfillCompleted = Number(state.backfill_completed) === 1;
  const latest = await readDocument(bucket, LATEST_KEY);
  const requested = new Map<string, string>();
  let backfilled = false;

  if (!backfillCompleted) {
    const keys = await datedObjectKeys(bucket);
    for (const item of keys.slice(-MAX_DAYS)) requested.set(item.date, item.key);
    backfilled = true;
  }
  for (const raw of chartDates) {
    const date = String(raw || "").trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) requested.set(date, `${PREFIX}${date}.json`);
  }

  const stateDate = String(state.latest_chart_date || "");
  const stateObservedAt = Number(state.latest_observed_at || 0);
  if (latest && (latest.chart_date !== stateDate || latest.observed_at > stateObservedAt)) {
    requested.set(latest.chart_date, `${PREFIX}${latest.chart_date}.json`);
  }

  if (!requested.size && backfillCompleted) {
    return {
      synced: true,
      backfilled: false,
      days: 0,
      rows: 0,
      latest_chart_date: latest?.chart_date ?? (stateDate || null),
    };
  }

  const roster = await trackedArtists(db);
  let rows = 0;
  let days = 0;
  for (const [, key] of [...requested.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const document = await readDocument(bucket, key);
    if (!document) continue;
    rows += await persistDocument(db, document, roster);
    days += 1;
  }
  await saveSyncState(db, backfillCompleted || backfilled, latest);

  return {
    synced: true,
    backfilled,
    days,
    rows,
    latest_chart_date: latest?.chart_date ?? null,
  };
}

export async function spotifyArtistChartHistoryResponse(request: Request, env: Env): Promise<Response> {
  const db = (env as ChartEnv).OTHER_DB;
  if (!db) {
    return json({ ok: false, error: "Spotify artist chart D1 storage unavailable" }, 503);
  }

  const url = new URL(request.url);
  const days = boundedDays(url.searchParams.get("days"));
  const artistNames = requestedArtists(url);
  const artists = new Set(artistNames);

  try {
    await syncSpotifyArtistChartR2ToD1(env);
    const result = await db.prepare(`WITH selected_dates AS (
        SELECT chart_date
        FROM sh_spotify_artist_chart_daily
        GROUP BY chart_date
        ORDER BY chart_date DESC
        LIMIT ?
      )
      SELECT chart.chart_date,chart.artist_key,chart.artist_name,chart.rank,
        chart.previous_rank,chart.peak_rank,chart.streak,chart.observed_at
      FROM sh_spotify_artist_chart_daily chart
      INNER JOIN selected_dates selected ON selected.chart_date=chart.chart_date
      ORDER BY chart.chart_date ASC,chart.rank ASC,chart.artist_name COLLATE NOCASE ASC`)
      .bind(days)
      .all();
    const rows = Array.isArray(result?.results) ? result.results : [];
    const grouped = new Map<string, Array<Record<string, unknown>>>();
    for (const row of rows) {
      const artistName = String(row?.artist_name || "").trim();
      if (artists.size && !artists.has(artistName)) continue;
      const chartDate = String(row?.chart_date || "").trim();
      if (!grouped.has(chartDate)) grouped.set(chartDate, []);
      grouped.get(chartDate)!.push({
        artist_key: String(row?.artist_key || ""),
        artist_name: artistName,
        rank: Number(row?.rank),
        previous_rank: row?.previous_rank == null ? null : Number(row.previous_rank),
        peak_rank: row?.peak_rank == null ? null : Number(row.peak_rank),
        streak: row?.streak == null ? null : Number(row.streak),
      });
    }
    const groupedDays = [...grouped.entries()].map(([chart_date, entries]) => ({ chart_date, entries }));
    const latestRow = rows.at(-1);
    return json({
      ok: true,
      chart_id: CHART_ID,
      latest_chart_date: latestRow ? String(latestRow.chart_date || "") : null,
      latest_observed_at: latestRow ? Number(latestRow.observed_at || 0) : null,
      requested_artists: artistNames,
      days: groupedDays,
      read_path: "d1-normalized",
    });
  } catch (error) {
    console.error("spotify-artist-chart-history-read-failed", {
      error: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300),
    });
    return json({ ok: false, error: "Spotify artist chart history unavailable" }, 503);
  }
}
