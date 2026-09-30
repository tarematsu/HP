const SAKURAZAKA = Object.freeze({ key: 'sakurazaka46', name: '櫻坂46' });
const DEFAULT_ARTIST_KEY = SAKURAZAKA.key;
export const SPOTIFY_TREND_START_DATE = '2026-09-28';
const JSON_HEADERS = Object.freeze({
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=3600',
  'x-content-type-options': 'nosniff',
  vary: 'accept-encoding',
});

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, ...headers },
  });
}

export function spotifyArtist(value) {
  const key = String(value || DEFAULT_ARTIST_KEY).trim().toLowerCase();
  return key === DEFAULT_ARTIST_KEY ? SAKURAZAKA : null;
}

export function spotifyPlaycountSql() {
  return `WITH latest AS (
    SELECT MAX(d.snapshot_date) AS snapshot_date
    FROM sh_spotify_playcount_daily d
    INNER JOIN sh_spotify_track_targets target ON target.track_id=d.track_id
    WHERE target.artist_key='sakurazaka46'
  )
  SELECT
    'sakurazaka46' AS artist_key,
    d.snapshot_date,
    ref.track_id,
    d.track_id AS spotify_track_id,
    track.name,
    d.playcount,
    d.delta,
    d.collected_at,
    COALESCE(d.is_carried_forward,0) AS is_carried_forward
  FROM latest
  INNER JOIN sh_spotify_track_targets target ON target.artist_key='sakurazaka46'
  INNER JOIN sh_spotify_playcount_daily d
    ON d.snapshot_date=latest.snapshot_date AND d.track_id=target.track_id
  INNER JOIN sh_spotify_tracks track ON track.track_id=d.track_id
  LEFT JOIN music_service_track_refs ref
    ON ref.service='spotify' AND ref.source_track_id=d.track_id
  ORDER BY
    CASE WHEN d.delta IS NULL THEN 1 ELSE 0 END,
    d.delta DESC,
    d.playcount DESC,
    track.name COLLATE NOCASE ASC,
    d.track_id ASC`;
}

export function spotifyTrendSql() {
  return `WITH latest_ranking_date AS (
    SELECT MAX(ranking_date) AS ranking_date FROM sh_spotify_top20_history
  ), current_rank AS (
    SELECT h.artist_key,h.rank
    FROM sh_spotify_top20_history h
    INNER JOIN latest_ranking_date latest ON latest.ranking_date=h.ranking_date
  )
  SELECT
    daily.artist_key,
    artist.artist_name,
    current_rank.rank AS current_rank,
    daily.snapshot_date,
    daily.total_delta,
    daily.top10_delta,
    daily.top10_year_delta
  FROM sh_spotify_artist_daily daily
  INNER JOIN sh_spotify_artists artist ON artist.artist_key=daily.artist_key
  LEFT JOIN current_rank ON current_rank.artist_key=daily.artist_key
  WHERE daily.snapshot_date >= '${SPOTIFY_TREND_START_DATE}'
  ORDER BY
    CASE WHEN current_rank.rank IS NULL THEN 1 ELSE 0 END,
    current_rank.rank ASC,
    artist.artist_name COLLATE NOCASE ASC,
    daily.snapshot_date ASC`;
}

export function spotifyArtistChartSql() {
  return `SELECT
    chart.chart_date,
    chart.artist_key,
    chart.artist_name,
    chart.rank,
    chart.previous_rank,
    chart.peak_rank,
    chart.streak,
    chart.observed_at
  FROM sh_spotify_artist_chart_daily chart
  WHERE chart.chart_date >= '${SPOTIFY_TREND_START_DATE}'
  ORDER BY chart.chart_date ASC,chart.rank ASC,chart.artist_name COLLATE NOCASE ASC`;
}

function integer(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

function normalizedTrackName(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('ja-JP')
    .replace(/\s+/gu, ' ')
    .trim();
}

function dedupeTrackRows(rows = []) {
  const unique = new Map();
  for (const row of rows) {
    const canonicalId = integer(row?.track_id);
    const key = canonicalId != null
      ? `track:${canonicalId}`
      : normalizedTrackName(row?.name) || `spotify:${String(row?.spotify_track_id || '')}`;
    const current = unique.get(key);
    if (!current) {
      unique.set(key, { ...row });
      continue;
    }

    const currentPlaycount = Math.max(0, integer(current.playcount) ?? 0);
    const nextPlaycount = Math.max(0, integer(row?.playcount) ?? 0);
    if (nextPlaycount > currentPlaycount) {
      current.track_id = row.track_id;
      current.spotify_track_id = row.spotify_track_id;
      current.name = row.name;
      current.playcount = row.playcount;
    }

    const currentDelta = integer(current.delta);
    const nextDelta = integer(row?.delta);
    if (currentDelta == null || (nextDelta != null && nextDelta > currentDelta)) {
      current.delta = row.delta;
    }
    current.collected_at = Math.max(integer(current.collected_at) ?? 0, integer(row?.collected_at) ?? 0);
    current.is_carried_forward = Number(current.is_carried_forward) === 1 && Number(row?.is_carried_forward) === 1 ? 1 : 0;
  }
  return [...unique.values()];
}

function compareTrackRows(a, b) {
  const aDelta = integer(a?.delta);
  const bDelta = integer(b?.delta);
  if (aDelta == null && bDelta != null) return 1;
  if (aDelta != null && bDelta == null) return -1;
  if (aDelta != null && bDelta != null && aDelta !== bDelta) return bDelta - aDelta;

  const aPlaycount = Math.max(0, integer(a?.playcount) ?? 0);
  const bPlaycount = Math.max(0, integer(b?.playcount) ?? 0);
  if (aPlaycount !== bPlaycount) return bPlaycount - aPlaycount;

  const byName = String(a?.name || '').localeCompare(String(b?.name || ''), 'ja', { sensitivity: 'base' });
  if (byName !== 0) return byName;
  return String(a?.track_id || '').localeCompare(String(b?.track_id || ''));
}

export function spotifyPayload(artist, rows = []) {
  const uniqueRows = dedupeTrackRows(rows).sort(compareTrackRows);
  const tracks = uniqueRows.map((row, index) => ({
    rank: index + 1,
    track_id: integer(row.track_id),
    spotify_track_id: String(row.spotify_track_id || ''),
    name: String(row.name || '').trim() || '曲名不明',
    playcount: Math.max(0, integer(row.playcount) ?? 0),
    delta: integer(row.delta),
    is_carried_forward: Number(row.is_carried_forward) === 1,
    collected_at: integer(row.collected_at),
  }));
  const snapshotDate = uniqueRows.length ? String(uniqueRows[0].snapshot_date || '') : null;
  const carriedForward = tracks.length > 0 && tracks.every((track) => track.is_carried_forward);
  const deltas = tracks.map((track) => track.delta).filter((value) => value != null);
  return {
    artist,
    snapshot_date: snapshotDate,
    carried_forward: carriedForward,
    track_count: tracks.length,
    unresolved_track_count: tracks.filter((track) => track.track_id == null).length,
    total_delta: deltas.length ? deltas.reduce((sum, value) => sum + value, 0) : null,
    tracks,
  };
}

export function spotifyTrend(rows = []) {
  const trend = {};
  for (const row of rows) {
    const artistKey = String(row?.artist_key || '').trim();
    if (!artistKey) continue;
    const snapshotDate = String(row?.snapshot_date || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshotDate)) continue;
    if (!trend[artistKey]) trend[artistKey] = [];
    trend[artistKey].push({
      snapshot_date: snapshotDate,
      artist_name: String(row?.artist_name || '').trim() || artistKey,
      current_rank: integer(row?.current_rank),
      total_delta: integer(row?.total_delta),
      top10_delta: integer(row?.top10_delta),
      top10_year_delta: integer(row?.top10_year_delta),
    });
  }
  return trend;
}

export function spotifyArtistChart(rows = []) {
  const days = new Map();
  let latestChartDate = null;
  let latestObservedAt = null;
  for (const row of rows) {
    const chartDate = String(row?.chart_date || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(chartDate)) continue;
    const rank = integer(row?.rank);
    if (rank == null || rank < 1 || rank > 200) continue;
    if (!days.has(chartDate)) days.set(chartDate, []);
    days.get(chartDate).push({
      artist_key: String(row?.artist_key || '').trim(),
      artist_name: String(row?.artist_name || '').trim() || String(row?.artist_key || '').trim(),
      rank,
      previous_rank: integer(row?.previous_rank),
      peak_rank: integer(row?.peak_rank),
      streak: integer(row?.streak),
    });
    if (latestChartDate == null || chartDate > latestChartDate) latestChartDate = chartDate;
    const observedAt = integer(row?.observed_at);
    if (observedAt != null && (latestObservedAt == null || observedAt > latestObservedAt)) {
      latestObservedAt = observedAt;
    }
  }
  return {
    chart_id: 'artist-jp-daily',
    latest_chart_date: latestChartDate,
    latest_observed_at: latestObservedAt,
    days: [...days.entries()].map(([chart_date, entries]) => ({ chart_date, entries })),
  };
}

export function spotifyReadModel(latestRows = [], trendRows = [], artistChartRows = []) {
  const sakurazakaRows = latestRows.filter((row) => String(row?.artist_key || '') === DEFAULT_ARTIST_KEY);
  const payload = spotifyPayload(SAKURAZAKA, sakurazakaRows);
  const trend = spotifyTrend(trendRows);
  const latestTrendPoint = (trend[DEFAULT_ARTIST_KEY] || [])
    .find((point) => point.snapshot_date === payload.snapshot_date);
  if (latestTrendPoint && payload.total_delta != null) {
    latestTrendPoint.total_delta = payload.total_delta;
  }
  return {
    default_artist: DEFAULT_ARTIST_KEY,
    groups: {
      [DEFAULT_ARTIST_KEY]: payload,
    },
    trend,
    artist_chart: spotifyArtistChart(artistChartRows),
  };
}

export async function onRequestGet({ env }) {
  if (!env?.OTHER_DB?.prepare) {
    return json({ ok: false, error: 'OTHER_DB binding missing' }, 503, {
      'cache-control': 'no-store',
    });
  }

  try {
    const [latestResult, trendResult, artistChartResult] = await Promise.all([
      env.OTHER_DB.prepare(spotifyPlaycountSql()).all(),
      env.OTHER_DB.prepare(spotifyTrendSql()).all(),
      env.OTHER_DB.prepare(spotifyArtistChartSql()).all(),
    ]);
    return json({
      ok: true,
      ...spotifyReadModel(
        Array.isArray(latestResult?.results) ? latestResult.results : [],
        Array.isArray(trendResult?.results) ? trendResult.results : [],
        Array.isArray(artistChartResult?.results) ? artistChartResult.results : [],
      ),
    });
  } catch (error) {
    console.error('spotify playcounts failed', error);
    return json({ ok: false, error: error?.message || 'spotify playcounts error' }, 500, {
      'cache-control': 'no-store',
    });
  }
}
