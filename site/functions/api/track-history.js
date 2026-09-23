import {
  TRACK_RANKING_SQL,
  TRACK_RANKING_SUMMARY_SQL,
} from '../lib/track-ranking.js';

const HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'public, max-age=300, s-maxage=900, stale-while-revalidate=3600',
};

const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: status >= 400 ? { ...HEADERS, 'cache-control': 'no-store' } : HEADERS,
});

function validDate(value) {
  const text = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const timestamp = Date.parse(`${text}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === text;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function rankingLimit(url) {
  const requested = Number(url.searchParams.get('ranking_limit'));
  return Number.isFinite(requested) && requested > 0
    ? Math.min(Math.max(Math.trunc(requested), 20), 500)
    : 200;
}

function text(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function normalizedIsrc(value) {
  return String(value || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase() || null;
}

function identifier(value) {
  const source = text(value);
  return Boolean(source && (
    /^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$/i.test(source)
    || /^[A-Za-z0-9]{22}$/.test(source)
    || /^spotify[_:-]?[a-z0-9]{8,}$/i.test(source)
  ));
}

function usable(value, type) {
  const source = text(value);
  if (!source || identifier(source)) return null;
  const normalized = source.normalize('NFKC').toLowerCase();
  if (type === 'title' && ['曲名不明', '曲名…', '曲名...', 'unknown', 'unknown title', '_', '-', '—'].includes(normalized)) return null;
  if (type === 'artist' && ['アーティスト不明', 'unknown', 'unknown artist', '_', '-', '—'].includes(normalized)) return null;
  return source;
}

function identityValue(row, prefix) {
  const identity = text(row?.track_identity);
  if (!identity) return null;
  for (const marker of [`${prefix}:`, `key:${prefix}:`]) {
    if (identity.startsWith(marker)) return text(identity.slice(marker.length));
  }
  return null;
}

function spotifyId(row) {
  return text(row?.spotify_id) || identityValue(row, 'spotify');
}

function isrc(row) {
  return normalizedIsrc(row?.isrc) || normalizedIsrc(identityValue(row, 'isrc'));
}

async function cachedRankingMetadata(db) {
  try {
    const row = await db.prepare(`SELECT payload_json
      FROM sh_pages_payload_read_model
      WHERE model_key='track-history-status'
      LIMIT 1`).first();
    if (!row?.payload_json) return [];
    const payload = JSON.parse(row.payload_json);
    return Array.isArray(payload?.ranking) ? payload.ranking : [];
  } catch (error) {
    if (/no such table|no such column/i.test(String(error?.message || error))) return [];
    return [];
  }
}

function rankingMetadataMaps(rows) {
  const byIdentity = new Map();
  const bySpotify = new Map();
  const byIsrc = new Map();
  for (const row of rows || []) {
    const identity = text(row?.track_identity);
    const spotify = spotifyId(row);
    const code = isrc(row);
    if (identity && !byIdentity.has(identity)) byIdentity.set(identity, row);
    if (spotify && !bySpotify.has(spotify)) bySpotify.set(spotify, row);
    if (code && !byIsrc.has(code)) byIsrc.set(code, row);
  }
  return { byIdentity, bySpotify, byIsrc };
}

function cachedMetadataFor(row, maps) {
  return maps.byIdentity.get(text(row?.track_identity))
    || maps.bySpotify.get(spotifyId(row))
    || maps.byIsrc.get(isrc(row))
    || null;
}

function publicRankingRow(row, cached, rank) {
  const currentSpotify = spotifyId(row) || spotifyId(cached);
  const currentIsrc = isrc(row) || isrc(cached);
  const title = usable(cached?.title, 'title')
    || usable(row?.direct_title, 'title')
    || usable(row?.isrc_title, 'title')
    || usable(row?.spotify_title, 'title')
    || usable(row?.current_title, 'title')
    || usable(row?.title, 'title')
    || '曲名不明';
  const artist = usable(cached?.artist, 'artist')
    || usable(row?.direct_artist, 'artist')
    || usable(row?.isrc_artist, 'artist')
    || usable(row?.spotify_artist, 'artist')
    || usable(row?.current_artist, 'artist')
    || usable(row?.artist, 'artist')
    || '—';
  return {
    rank,
    track_identity: text(row?.track_identity),
    track_id: row?.track_id ?? null,
    title,
    artist,
    display_title: text(cached?.display_title),
    thumbnail_url: text(cached?.thumbnail_url),
    spotify_id: currentSpotify,
    isrc: currentIsrc,
    latest_like_count: Number(row?.latest_like_count || 0),
    latest_observed_at: Number(row?.latest_observed_at || 0) || null,
    latest_occurrence_key: text(row?.latest_occurrence_key),
  };
}

async function loadTrackRankingReadOnly(db, { limit = 500 } = {}) {
  const boundedLimit = Math.min(Math.max(Math.trunc(Number(limit) || 500), 20), 500);
  const [result, summary, cachedRows] = await Promise.all([
    db.prepare(TRACK_RANKING_SQL).bind(boundedLimit).all(),
    db.prepare(TRACK_RANKING_SUMMARY_SQL).first(),
    cachedRankingMetadata(db),
  ]);
  const maps = rankingMetadataMaps(cachedRows);
  const rows = (result.results || []).map((row, index) =>
    publicRankingRow(row, cachedMetadataFor(row, maps), index + 1));
  return {
    rows,
    summary: {
      track_count: Number(summary?.track_count || 0),
      max_like_count: Number(summary?.max_like_count || 0),
      latest_observed_at: Number(summary?.latest_observed_at || 0) || null,
    },
  };
}

export async function onRequestGet({ request, env }) {
  if (!env?.MINUTE_DB) return json({ ok: false, error: 'MINUTE_DB binding missing' }, 500);
  const url = new URL(request.url);

  try {
    if (url.searchParams.get('ranking_only') === '1') {
      const limit = rankingLimit(url);
      const ranking = await loadTrackRankingReadOnly(env.MINUTE_DB, { limit });
      return json({
        ok: true,
        mode: 'likes',
        timezone: 'UTC',
        rows: [],
        ranking_included: true,
        ranking: ranking.rows,
        ranking_limit: ranking.rows.length,
        ranking_truncated: ranking.summary.track_count > ranking.rows.length,
        ranking_summary: ranking.summary,
        ranking_scope: 'all-time-latest-counter',
        generated_at: ranking.summary.latest_observed_at,
        method: 'current_track_like_ranking',
        read_path: 'read_only',
      });
    }

    if (url.searchParams.get('latest') === '1') {
      const latest = await env.MINUTE_DB.prepare(`SELECT MAX(play_date) AS play_date
        FROM sh_pages_track_history_read_model`).first();
      return json({ ok: true, latest_date: latest?.play_date || null, timezone: 'UTC' });
    }

    const from = url.searchParams.get('from') || '2024-05-01';
    const to = url.searchParams.get('to') || today();
    if (!validDate(from) || !validDate(to) || from > to) {
      return json({ ok: false, error: 'invalid date range' }, 400);
    }
    const requestedLimit = Number(url.searchParams.get('limit'));
    const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
      ? Math.min(Math.max(Math.trunc(requestedLimit), 100), 20_000)
      : 10_000;
    const includeRanking = url.searchParams.get('ranking') !== '0';
    const boundedRankingLimit = rankingLimit(url);

    const rowsPromise = env.MINUTE_DB.prepare(`SELECT row_json
      FROM sh_pages_track_history_read_model
      WHERE play_date>=? AND play_date<=?
      ORDER BY play_date ASC,first_played_at ASC,row_key ASC
      LIMIT ?`).bind(from, to, limit + 1).all();
    const statusPromise = includeRanking
      ? env.MINUTE_DB.prepare(`SELECT payload_json
          FROM sh_pages_payload_read_model
          WHERE model_key='track-history-status'
          LIMIT 1`).first()
      : Promise.resolve(null);
    const [result, status] = await Promise.all([rowsPromise, statusPromise]);

    const rawRows = result.results || [];
    const truncated = rawRows.length > limit;
    const rows = rawRows.slice(0, limit).map((row) => JSON.parse(row.row_json));
    const metadata = status?.payload_json ? JSON.parse(status.payload_json) : {};
    const fullRanking = includeRanking && Array.isArray(metadata.ranking) ? metadata.ranking : [];
    const ranking = fullRanking.slice(0, boundedRankingLimit);
    const rankingSummary = includeRanking
      && metadata.ranking_summary && typeof metadata.ranking_summary === 'object'
      ? metadata.ranking_summary
      : {};

    return json({
      ok: true,
      mode: 'tracks',
      from,
      to,
      timezone: 'UTC',
      rows,
      truncated,
      likes_included: true,
      ranking_included: includeRanking,
      ranking,
      ranking_limit: includeRanking ? boundedRankingLimit : 0,
      ranking_truncated: includeRanking && fullRanking.length > ranking.length,
      ranking_summary: rankingSummary,
      ranking_scope: includeRanking ? 'all-time-latest-counter' : null,
      source_row_count: includeRanking ? metadata.source_row_count || 0 : null,
      excluded_play_count_dates: includeRanking ? metadata.excluded_play_count_dates || [] : [],
      excluded_play_count_date_count: includeRanking
        ? (metadata.excluded_play_count_dates || []).length
        : 0,
      generated_at: includeRanking ? metadata.generated_at || null : null,
      historical_recovery: 'worker_materialized_read_model',
      method: 'precomputed_track_history_read_model',
    });
  } catch (error) {
    if (/no such table/i.test(String(error?.message || ''))) {
      return json({
        ok: true,
        mode: url.searchParams.get('ranking_only') === '1' ? 'likes' : 'tracks',
        rows: [],
        ranking: [],
        ranking_summary: {},
        setup_required: true,
        timezone: 'UTC',
      });
    }
    return json({ ok: false, error: error?.message || 'track history error' }, 500);
  }
}
