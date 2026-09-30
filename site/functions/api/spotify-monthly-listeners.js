const JSON_HEADERS = Object.freeze({
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=3600',
  'x-content-type-options': 'nosniff',
  vary: 'accept-encoding',
});
const SVG_HEADERS = Object.freeze({
  'content-type': 'image/svg+xml; charset=utf-8',
  'cache-control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=3600',
  'x-content-type-options': 'nosniff',
});
const COLORS = Object.freeze([
  '#f3a6c8', '#8264b0', '#9ecff3', '#ef8a62', '#67a9cf',
  '#a6d854', '#ffd92f', '#e78ac3', '#8da0cb', '#66c2a5',
]);

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

function escapeXml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function shortDate(value) {
  const match = String(value || '').match(/^\d{4}-(\d{2})-(\d{2})$/);
  return match ? `${Number(match[1])}/${Number(match[2])}` : String(value || '');
}

function compact(value) {
  const number = Math.round(Number(value) || 0);
  if (Math.abs(number) >= 1000000) return `${(number / 1000000).toFixed(1).replace(/\.0$/, '')}M`;
  if (Math.abs(number) >= 1000) return `${(number / 1000).toFixed(0)}K`;
  return String(number);
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

export function selectMonthlyListenerSeries(trend = {}, limit = 10) {
  const all = Object.entries(trend).map(([artistKey, points]) => ({
    artistKey,
    artistName: String(points?.[0]?.artist_name || artistKey),
    points: Array.isArray(points) ? points : [],
  }));
  const latestDate = all.flatMap(({ points }) => points.map((point) => String(point.snapshot_date || '')))
    .sort().at(-1) || '';
  return all.map((series) => ({
    series,
    value: integer(series.points.find((point) => point.snapshot_date === latestDate)?.monthly_listeners),
  })).filter(({ value }) => value != null)
    .sort((a, b) => b.value - a.value || a.series.artistName.localeCompare(b.series.artistName, 'ja'))
    .slice(0, limit)
    .map(({ series }) => series);
}

export function spotifyMonthlyListenersSvg(rows = []) {
  const { trend } = spotifyMonthlyListenersTrend(rows);
  const series = selectMonthlyListenerSeries(trend);
  const dates = [...new Set(series.flatMap((item) => item.points.map((point) => point.snapshot_date)))].sort();
  const values = series.flatMap((item) => item.points.map((point) => integer(point.monthly_listeners)))
    .filter((value) => value != null);
  const width = 960;
  const height = 340;
  if (!dates.length || !values.length) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Spotify月間リスナーの推移データはまだありません"><rect width="100%" height="100%" fill="transparent"/><text x="24" y="44" fill="currentColor" font-family="sans-serif" font-size="16">Spotify月間リスナーの推移データはまだありません。</text></svg>`;
  }

  const margin = { left: 76, right: 22, top: 78, bottom: 38 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const padding = Math.max(1, Math.ceil(Math.max(rawMax - rawMin, rawMax * 0.02) * 0.12));
  const yMin = Math.max(0, rawMin - padding);
  const yMax = Math.max(yMin + 1, rawMax + padding);
  const yRange = yMax - yMin;
  const x = (date) => {
    const index = dates.indexOf(date);
    return margin.left + (dates.length <= 1 ? plotWidth / 2 : index / (dates.length - 1) * plotWidth);
  };
  const y = (value) => margin.top + (yMax - value) / yRange * plotHeight;
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Spotify月間リスナー推移">`,
    '<style>text{font-family:system-ui,-apple-system,sans-serif;fill:#666}.g{stroke:#ddd;stroke-width:1}.l{fill:none;stroke-width:2}.p{stroke-width:1.5}.n{font-size:12px}.a{font-size:11px}</style>'];

  series.forEach((item, index) => {
    const latest = [...item.points].reverse().find((point) => integer(point.monthly_listeners) != null);
    const lx = 12 + (index % 5) * 190;
    const ly = 20 + Math.floor(index / 5) * 25;
    const color = COLORS[index % COLORS.length];
    parts.push(`<circle cx="${lx}" cy="${ly - 4}" r="4" fill="${color}"/><text class="n" x="${lx + 9}" y="${ly}">${escapeXml(item.artistName)} ${latest ? Number(latest.monthly_listeners).toLocaleString('ja-JP') : '-'}</text>`);
  });

  for (let tick = 0; tick <= 4; tick += 1) {
    const value = yMax - yRange * tick / 4;
    const yy = y(value);
    parts.push(`<line class="g" x1="${margin.left}" y1="${yy}" x2="${width - margin.right}" y2="${yy}"/><text class="a" x="${margin.left - 8}" y="${yy + 4}" text-anchor="end">${compact(value)}</text>`);
  }
  const tickIndexes = [...new Set(dates.length <= 1 ? [0] : [0, .25, .5, .75, 1]
    .map((ratio) => Math.round((dates.length - 1) * ratio)))];
  tickIndexes.forEach((index) => {
    const xx = x(dates[index]);
    parts.push(`<text class="a" x="${xx}" y="${height - 12}" text-anchor="${index === 0 ? 'start' : index === dates.length - 1 ? 'end' : 'middle'}">${shortDate(dates[index])}</text>`);
  });

  series.forEach((item, index) => {
    const color = COLORS[index % COLORS.length];
    const points = item.points.filter((point) => integer(point.monthly_listeners) != null)
      .map((point) => ({ date: point.snapshot_date, value: integer(point.monthly_listeners) }));
    if (points.length > 1) {
      parts.push(`<polyline class="l" stroke="${color}" points="${points.map((point) => `${x(point.date).toFixed(1)},${y(point.value).toFixed(1)}`).join(' ')}"/>`);
    }
    points.forEach((point) => {
      parts.push(`<circle class="p" cx="${x(point.date).toFixed(1)}" cy="${y(point.value).toFixed(1)}" r="2.5" fill="${color}" stroke="${color}"><title>${escapeXml(item.artistName)} ${point.date} ${point.value.toLocaleString('ja-JP')}人</title></circle>`);
    });
  });
  parts.push('</svg>');
  return parts.join('');
}

export async function onRequestGet({ env, request }) {
  if (!env?.OTHER_DB?.prepare) {
    return json({ ok: false, error: 'OTHER_DB binding missing' }, 503, {
      'cache-control': 'no-store',
    });
  }
  try {
    const result = await env.OTHER_DB.prepare(spotifyMonthlyListenersSql()).all();
    const rows = Array.isArray(result?.results) ? result.results : [];
    const format = request?.url ? new URL(request.url).searchParams.get('format') : null;
    if (format === 'svg') return new Response(spotifyMonthlyListenersSvg(rows), { headers: SVG_HEADERS });
    return json({ ok: true, ...spotifyMonthlyListenersTrend(rows) });
  } catch (error) {
    console.error('spotify monthly listeners failed', error);
    return json({ ok: false, error: error?.message || 'spotify monthly listeners error' }, 500, {
      'cache-control': 'no-store',
    });
  }
}
