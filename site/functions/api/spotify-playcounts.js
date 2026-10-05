import {
  SPOTIFY_DEFAULT_ARTIST_KEY,
  SPOTIFY_DETAIL_ARTISTS,
  SPOTIFY_TREND_START_DATE,
  spotifyArtistChart,
  spotifyArtistChartSql,
  spotifyPayload,
  spotifyReadModel,
  spotifyReadModelAll,
  spotifyTrend,
  spotifyTrendSql,
} from '../../../packages/sh-shared/spotify-read-model.mjs';
import { canonicalizeTrackRows } from '../lib/canonical-track-rows.js';

export {
  SPOTIFY_DETAIL_ARTISTS,
  SPOTIFY_TREND_START_DATE,
  spotifyArtistChart,
  spotifyArtistChartSql,
  spotifyPayload,
  spotifyReadModel,
  spotifyReadModelAll,
  spotifyTrend,
  spotifyTrendSql,
};

const SAKURAZAKA = SPOTIFY_DETAIL_ARTISTS[0];
const DEFAULT_ARTIST_KEY = SPOTIFY_DEFAULT_ARTIST_KEY;
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
  return `SELECT
    'sakurazaka46' AS artist_key,
    d.snapshot_date,
    ref.track_id,
    d.track_id AS spotify_track_id,
    track.name,
    d.playcount,
    d.delta,
    d.collected_at,
    COALESCE(d.is_carried_forward,0) AS is_carried_forward
  FROM sh_spotify_track_targets AS target INDEXED BY idx_sh_spotify_track_targets_artist
  INNER JOIN sh_spotify_playcount_daily AS d
    ON d.track_id=target.track_id
    AND d.snapshot_date=(
      SELECT MAX(snapshot_date)
      FROM sh_spotify_artist_daily
      WHERE artist_key='sakurazaka46'
    )
  INNER JOIN sh_spotify_tracks AS track ON track.track_id=d.track_id
  LEFT JOIN music_service_track_refs AS ref
    ON ref.service='spotify' AND ref.source_track_id=d.track_id
  WHERE target.artist_key='sakurazaka46'
  ORDER BY
    CASE WHEN d.delta IS NULL THEN 1 ELSE 0 END,
    d.delta DESC,
    d.playcount DESC,
    track.name COLLATE NOCASE ASC,
    d.track_id ASC`;
}

export function spotifyLatestSnapshotDatesSql() {
  return `SELECT artist_key,MAX(snapshot_date) AS snapshot_date
  FROM sh_spotify_artist_daily
  WHERE artist_key IN (?,?,?)
  GROUP BY artist_key`;
}

export function spotifyLatestDetailSql() {
  return `SELECT
    target.artist_key,
    d.snapshot_date,
    ref.track_id,
    d.track_id AS spotify_track_id,
    track.name,
    d.playcount,
    d.delta,
    d.collected_at,
    COALESCE(d.is_carried_forward,0) AS is_carried_forward
  FROM sh_spotify_track_targets AS target INDEXED BY idx_sh_spotify_track_targets_artist
  INNER JOIN sh_spotify_playcount_daily AS d
    ON d.track_id=target.track_id AND d.snapshot_date=?
  INNER JOIN sh_spotify_tracks AS track ON track.track_id=d.track_id
  LEFT JOIN music_service_track_refs AS ref
    ON ref.service='spotify' AND ref.source_track_id=d.track_id
  WHERE target.artist_key=?
  ORDER BY
    CASE WHEN d.delta IS NULL THEN 1 ELSE 0 END,
    d.delta DESC,
    d.playcount DESC,
    track.name COLLATE NOCASE ASC,
    d.track_id ASC`;
}

export function spotifyPlaycountAllSql() {
  const detail = (artistKey) => `SELECT
    target.artist_key,
    d.snapshot_date,
    ref.track_id,
    d.track_id AS spotify_track_id,
    track.name,
    d.playcount,
    d.delta,
    d.collected_at,
    COALESCE(d.is_carried_forward,0) AS is_carried_forward
  FROM sh_spotify_track_targets AS target INDEXED BY idx_sh_spotify_track_targets_artist
  INNER JOIN sh_spotify_playcount_daily AS d
    ON d.track_id=target.track_id
    AND d.snapshot_date=(
      SELECT MAX(snapshot_date)
      FROM sh_spotify_artist_daily
      WHERE artist_key='${artistKey}'
    )
  INNER JOIN sh_spotify_tracks AS track ON track.track_id=d.track_id
  LEFT JOIN music_service_track_refs AS ref
    ON ref.service='spotify' AND ref.source_track_id=d.track_id
  WHERE target.artist_key='${artistKey}'`;
  return `${SPOTIFY_DETAIL_ARTISTS.map(({ key }) => detail(key)).join('\nUNION ALL\n')}
  ORDER BY
    artist_key ASC,
    CASE WHEN delta IS NULL THEN 1 ELSE 0 END,
    delta DESC,
    playcount DESC,
    name COLLATE NOCASE ASC,
    spotify_track_id ASC`;
}

export async function loadSpotifyLatestRows(db) {
  const artistKeys = SPOTIFY_DETAIL_ARTISTS.map(({ key }) => key);
  const datesResult = await db
    .prepare(spotifyLatestSnapshotDatesSql())
    .bind(...artistKeys)
    .all();
  const dates = new Map(
    (Array.isArray(datesResult?.results) ? datesResult.results : [])
      .map((row) => [String(row?.artist_key || ''), String(row?.snapshot_date || '')]),
  );
  const batches = await Promise.all(artistKeys.map(async (artistKey) => {
    const snapshotDate = dates.get(artistKey);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshotDate || '')) return [];
    const result = await db
      .prepare(spotifyLatestDetailSql())
      .bind(snapshotDate, artistKey)
      .all();
    return Array.isArray(result?.results) ? result.results : [];
  }));
  return batches.flat();
}

function integer(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

export async function canonicalizeSpotifyPlaycountRows(db, rows = []) {
  if (!Array.isArray(rows) || !rows.length) return rows;
  const candidates = rows.map((row) => ({
    ...row,
    title: String(row?.name || '').trim() || null,
    spotify_id: String(row?.spotify_track_id || '').trim() || null,
  }));
  const canonical = await canonicalizeTrackRows(db, candidates);
  return canonical.map((row, index) => {
    const original = rows[index] || {};
    const trackId = integer(row?.track_id) ?? integer(original?.track_id);
    const name = String(row?.title || original?.name || '').trim();
    if (trackId === integer(original?.track_id)
        && name === String(original?.name || '').trim()) return original;
    return {
      ...original,
      track_id: trackId,
      name: name || String(original?.name || '').trim(),
    };
  });
}

export async function onRequestGet({ env, request }) {
  if (!env?.OTHER_DB?.prepare) {
    return json({ ok: false, error: 'OTHER_DB binding missing' }, 503, {
      'cache-control': 'no-store',
    });
  }

  try {
    const includeSakamichi = request?.url
      ? new URL(request.url).searchParams.get('artists') === 'sakamichi'
      : false;
    const latestRowsPromise = includeSakamichi
      ? loadSpotifyLatestRows(env.OTHER_DB)
      : env.OTHER_DB.prepare(spotifyPlaycountSql()).all()
        .then((result) => (Array.isArray(result?.results) ? result.results : []));
    const [sourceLatestRows, trendResult, artistChartResult] = await Promise.all([
      latestRowsPromise,
      env.OTHER_DB.prepare(spotifyTrendSql()).all(),
      env.OTHER_DB.prepare(spotifyArtistChartSql()).all(),
    ]);
    const latestRows = await canonicalizeSpotifyPlaycountRows(env?.MINUTE_DB, sourceLatestRows);
    const trendRows = Array.isArray(trendResult?.results) ? trendResult.results : [];
    const artistChartRows = Array.isArray(artistChartResult?.results) ? artistChartResult.results : [];
    return json({
      ok: true,
      ...(includeSakamichi
        ? spotifyReadModelAll(latestRows, trendRows, artistChartRows)
        : spotifyReadModel(latestRows, trendRows, artistChartRows)),
    });
  } catch (error) {
    console.error('spotify playcounts failed', error);
    return json({ ok: false, error: error?.message || 'spotify playcounts error' }, 500, {
      'cache-control': 'no-store',
    });
  }
}
