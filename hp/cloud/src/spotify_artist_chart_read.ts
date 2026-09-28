import type { Env } from "./sources";

const CHART_ID = "artist-jp-daily";
const PREFIX = "spotify/charts/artist-jp-daily/";
const LATEST_KEY = `${PREFIX}latest.json`;
const DATE_OBJECT = /^spotify\/charts\/artist-jp-daily\/(\d{4}-\d{2}-\d{2})\.json$/;
const DEFAULT_DAYS = 90;
const MAX_DAYS = 90;
const MAX_ARTISTS = 50;
const MAX_ARTIST_NAME = 240;

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

function responseHeaders(): HeadersInit {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "public, max-age=300, s-maxage=900, stale-while-revalidate=3600",
    "Access-Control-Allow-Origin": "*",
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

function validDocument(value: unknown): StoredArtistChartDocument | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const document = value as Record<string, unknown>;
  if (Number(document.version) !== 1 || document.chart_id !== CHART_ID) return null;
  const chartDate = String(document.chart_date || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(chartDate) || !Array.isArray(document.entries)) return null;
  const entries = document.entries.filter((entry): entry is StoredArtistChartEntry => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
    const candidate = entry as Record<string, unknown>;
    return Number.isSafeInteger(Number(candidate.rank))
      && Number(candidate.rank) >= 1
      && Number(candidate.rank) <= 200
      && Boolean(String(candidate.artist_name || "").trim());
  }).map((entry) => ({
    ...entry,
    rank: Number(entry.rank),
    artist_name: String(entry.artist_name || "").trim(),
  }));
  const receivedAt = Number(document.received_at);
  return {
    version: 1,
    chart_id: CHART_ID,
    chart_date: chartDate,
    observed_at: Number(document.observed_at) || 0,
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

function filteredDocument(
  document: StoredArtistChartDocument,
  artists: Set<string>,
): Record<string, unknown> {
  const entries = artists.size
    ? document.entries.filter((entry) => artists.has(entry.artist_name))
    : document.entries;
  return {
    chart_date: document.chart_date,
    observed_at: document.observed_at,
    entry_count: document.entry_count,
    entries,
  };
}

export async function spotifyArtistChartHistoryResponse(request: Request, env: Env): Promise<Response> {
  if (!env.DATA_BUCKET) {
    return json({ ok: false, error: "Spotify artist chart storage unavailable" }, 503);
  }

  const url = new URL(request.url);
  const days = boundedDays(url.searchParams.get("days"));
  const artistNames = requestedArtists(url);
  const artists = new Set(artistNames);

  try {
    const [latest, keys] = await Promise.all([
      readDocument(env.DATA_BUCKET, LATEST_KEY),
      datedObjectKeys(env.DATA_BUCKET),
    ]);
    const selectedKeys = keys.slice(-days);
    const documents = (await Promise.all(
      selectedKeys.map(({ key }) => readDocument(env.DATA_BUCKET!, key)),
    )).filter((document): document is StoredArtistChartDocument => Boolean(document));

    if (!documents.length && latest) documents.push(latest);
    documents.sort((left, right) => left.chart_date.localeCompare(right.chart_date));
    const newest = latest || documents.at(-1) || null;

    return json({
      ok: true,
      chart_id: CHART_ID,
      latest_chart_date: newest?.chart_date ?? null,
      latest_observed_at: newest?.observed_at ?? null,
      latest_entry_count: newest?.entry_count ?? 0,
      requested_artists: artistNames,
      days: documents.map((document) => filteredDocument(document, artists)),
    });
  } catch (error) {
    console.error("spotify-artist-chart-history-read-failed", {
      error: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300),
    });
    return json({ ok: false, error: "Spotify artist chart history unavailable" }, 503);
  }
}
