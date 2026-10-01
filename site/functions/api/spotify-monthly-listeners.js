const JSON_HEADERS = Object.freeze({
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=3600',
  'x-content-type-options': 'nosniff',
  vary: 'accept-encoding',
});
const SPOTIFY_READ_MODEL_URL = 'https://pages-read-model.internal/_internal/pages-response?key=spotify-playcounts';

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, ...headers },
  });
}

function integer(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

export function spotifyMonthlyListenersSql() {
  return `WITH latest_ranking_date AS (
    SELECT MAX(ranking_date) AS ranking_date FROM sh_spotify_top20_history
  ), current_rank AS (
    SELECT history.artist_key,history.rank
    FROM sh_spotify_top20_history history
    INNER JOIN latest_ranking_date latest ON latest.ranking_date=history.ranking_date
  )
  SELECT
    daily.snapshot_date,
    daily.artist_key,
    artist.artist_name,
    daily.monthly_listeners,
    daily.collected_at,
    current_rank.rank AS current_rank
  FROM sh_spotify_artist_monthly_listeners_daily daily
  INNER JOIN sh_spotify_artists artist ON artist.artist_key=daily.artist_key
  LEFT JOIN current_rank ON current_rank.artist_key=daily.artist_key
  ORDER BY daily.snapshot_date ASC,artist.artist_name COLLATE NOCASE ASC`;
}

export function spotifyMonthlyListenersTrend(rows = []) {
  const trend = {};
  let latestSnapshotDate = null;
  for (const row of rows) {
    const artistKey = String(row?.artist_key || '').trim();
    const snapshotDate = String(row?.snapshot_date || '').trim();
    const monthlyListeners = integer(row?.monthly_listeners);
    if (!artistKey || !/^\d{4}-\d{2}-\d{2}$/.test(snapshotDate) || monthlyListeners == null || monthlyListeners < 0) {
      continue;
    }
    if (!trend[artistKey]) trend[artistKey] = [];
    trend[artistKey].push({
      snapshot_date: snapshotDate,
      artist_name: String(row?.artist_name || '').trim() || artistKey,
      current_rank: integer(row?.current_rank),
      monthly_listeners: monthlyListeners,
      collected_at: integer(row?.collected_at),
    });
    if (latestSnapshotDate == null || snapshotDate > latestSnapshotDate) latestSnapshotDate = snapshotDate;
  }
  return { latest_snapshot_date: latestSnapshotDate, trend };
}

async function materializedMonthlyListenerRows(env) {
  const service = env?.PAGES_READ_MODEL_SERVICE;
  if (typeof service?.fetch !== 'function') {
    throw new Error('PAGES_READ_MODEL_SERVICE binding missing');
  }
  const response = await service.fetch(new Request(SPOTIFY_READ_MODEL_URL, {
    method: 'GET',
    headers: { accept: 'application/json' },
  }));
  if (!response?.ok) {
    throw new Error(`Spotify read model returned HTTP ${response?.status || 503}`);
  }
  const payload = await response.json().catch(() => null);
  if (!payload || !Array.isArray(payload.monthly_listener_rows)) {
    throw new Error('Spotify read model does not contain monthly listener history');
  }
  return payload.monthly_listener_rows;
}

export async function onRequestGet({ env }) {
  try {
    const rows = await materializedMonthlyListenerRows(env);
    return json({ ok: true, ...spotifyMonthlyListenersTrend(rows) });
  } catch (error) {
    console.error('spotify monthly listeners failed', error);
    return json({ ok: false, error: error?.message || 'spotify monthly listeners error' }, 503, {
      'cache-control': 'no-store',
    });
  }
}
