const ARTISTS = Object.freeze({
  nogizaka46: Object.freeze({ key: 'nogizaka46', name: '乃木坂46' }),
  sakurazaka46: Object.freeze({ key: 'sakurazaka46', name: '櫻坂46' }),
  hinatazaka46: Object.freeze({ key: 'hinatazaka46', name: '日向坂46' }),
});

const DEFAULT_ARTIST_KEY = 'sakurazaka46';
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
  return ARTISTS[key] || null;
}

export function spotifyPlaycountSql() {
  return `WITH latest AS (
    SELECT target.artist_key, MAX(d.snapshot_date) AS snapshot_date
    FROM sh_spotify_playcount_daily d
    INNER JOIN sh_spotify_track_targets target ON target.track_id=d.track_id
    WHERE target.artist_key IN ('nogizaka46','sakurazaka46','hinatazaka46')
    GROUP BY target.artist_key
  )
  SELECT
    latest.artist_key,
    d.snapshot_date,
    d.track_id,
    track.name,
    d.playcount,
    d.delta,
    d.collected_at,
    COALESCE(d.is_carried_forward,0) AS is_carried_forward
  FROM latest
  INNER JOIN sh_spotify_track_targets target ON target.artist_key=latest.artist_key
  INNER JOIN sh_spotify_playcount_daily d
    ON d.snapshot_date=latest.snapshot_date AND d.track_id=target.track_id
  INNER JOIN sh_spotify_tracks track ON track.track_id=d.track_id
  ORDER BY
    CASE latest.artist_key
      WHEN 'nogizaka46' THEN 1
      WHEN 'sakurazaka46' THEN 2
      WHEN 'hinatazaka46' THEN 3
      ELSE 4
    END,
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
    target.artist_key,
    artist.artist_name,
    current_rank.rank AS current_rank,
    d.snapshot_date,
    COUNT(*) AS track_count,
    CASE WHEN COUNT(d.delta)=0 THEN NULL ELSE SUM(d.delta) END AS total_delta,
    CASE
      WHEN COUNT(*)>0
       AND SUM(CASE WHEN COALESCE(d.is_carried_forward,0)=1 THEN 1 ELSE 0 END)=COUNT(*)
      THEN 1 ELSE 0
    END AS is_carried_forward
  FROM sh_spotify_playcount_daily d
  INNER JOIN sh_spotify_track_targets target ON target.track_id=d.track_id
  INNER JOIN sh_spotify_artists artist ON artist.artist_key=target.artist_key
  LEFT JOIN current_rank ON current_rank.artist_key=target.artist_key
  WHERE d.snapshot_date >= date((SELECT MAX(snapshot_date) FROM sh_spotify_playcount_daily), '-89 days')
  GROUP BY target.artist_key, artist.artist_name, current_rank.rank, d.snapshot_date
  ORDER BY
    CASE WHEN current_rank.rank IS NULL THEN 1 ELSE 0 END,
    current_rank.rank ASC,
    artist.artist_name COLLATE NOCASE ASC,
    d.snapshot_date ASC`;
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
      artist_name: String(row?.artist_name || '').trim() || ARTISTS[artistKey]?.name || artistKey,
      current_rank: integer(row?.current_rank),
      total_delta: integer(row?.total_delta),
      track_count: Math.max(0, integer(row?.track_count) ?? 0),
      carried_forward: Number(row?.is_carried_forward) === 1,
    });
  }
  return trend;
}

export function spotifyReadModel(latestRows = [], trendRows = []) {
  const rowsByArtist = new Map(Object.keys(ARTISTS).map((key) => [key, []]));
  for (const row of latestRows) {
    const artist = spotifyArtist(row?.artist_key);
    if (artist) rowsByArtist.get(artist.key).push(row);
  }

  const groups = {};
  for (const artist of Object.values(ARTISTS)) {
    groups[artist.key] = spotifyPayload(artist, rowsByArtist.get(artist.key));
  }
  return {
    default_artist: DEFAULT_ARTIST_KEY,
    groups,
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
