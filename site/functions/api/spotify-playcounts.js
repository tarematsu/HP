const SAKURAZAKA = Object.freeze({ key: 'sakurazaka46', name: '櫻坂46' });
const DEFAULT_ARTIST_KEY = SAKURAZAKA.key;
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
    d.track_id,
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
  ORDER BY
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
  ), latest_snapshot AS (
    SELECT MAX(snapshot_date) AS snapshot_date FROM sh_spotify_artist_daily
  )
  SELECT
    daily.artist_key,
    artist.artist_name,
    current_rank.rank AS current_rank,
    daily.snapshot_date,
    daily.total_delta
  FROM sh_spotify_artist_daily daily
  INNER JOIN sh_spotify_artists artist ON artist.artist_key=daily.artist_key
  LEFT JOIN current_rank ON current_rank.artist_key=daily.artist_key
  WHERE daily.snapshot_date >= date((SELECT snapshot_date FROM latest_snapshot), '-89 days')
  ORDER BY
    CASE WHEN current_rank.rank IS NULL THEN 1 ELSE 0 END,
    current_rank.rank ASC,
    artist.artist_name COLLATE NOCASE ASC,
    daily.snapshot_date ASC`;
}

function integer(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

export function spotifyPayload(artist, rows = []) {
  const tracks = rows.map((row, index) => ({
    rank: index + 1,
    track_id: String(row.track_id || ''),
    name: String(row.name || '').trim() || '曲名不明',
    playcount: Math.max(0, integer(row.playcount) ?? 0),
    delta: integer(row.delta),
    is_carried_forward: Number(row.is_carried_forward) === 1,
    collected_at: integer(row.collected_at),
  }));
  const snapshotDate = rows.length ? String(rows[0].snapshot_date || '') : null;
  const carriedForward = tracks.length > 0 && tracks.every((track) => track.is_carried_forward);
  const deltas = tracks.map((track) => track.delta).filter((value) => value != null);
  return {
    artist,
    snapshot_date: snapshotDate,
    carried_forward: carriedForward,
    track_count: tracks.length,
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
    });
  }
  return trend;
}

export function spotifyReadModel(latestRows = [], trendRows = []) {
  const sakurazakaRows = latestRows.filter((row) => String(row?.artist_key || '') === DEFAULT_ARTIST_KEY);
  return {
    default_artist: DEFAULT_ARTIST_KEY,
    groups: {
      [DEFAULT_ARTIST_KEY]: spotifyPayload(SAKURAZAKA, sakurazakaRows),
    },
    trend: spotifyTrend(trendRows),
  };
}

export async function onRequestGet({ env }) {
  if (!env?.OTHER_DB?.prepare) {
    return json({ ok: false, error: 'OTHER_DB binding missing' }, 503, {
      'cache-control': 'no-store',
    });
  }

  try {
    const latestResult = await env.OTHER_DB.prepare(spotifyPlaycountSql()).all();
    const trendResult = await env.OTHER_DB.prepare(spotifyTrendSql()).all();
    return json({
      ok: true,
      ...spotifyReadModel(
        Array.isArray(latestResult?.results) ? latestResult.results : [],
        Array.isArray(trendResult?.results) ? trendResult.results : [],
      ),
    });
  } catch (error) {
    console.error('spotify playcounts failed', error);
    return json({ ok: false, error: error?.message || 'spotify playcounts error' }, 500, {
      'cache-control': 'no-store',
    });
  }
}
