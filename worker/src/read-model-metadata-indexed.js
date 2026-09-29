import {
  sanitizeMetadataRow,
  trackArtistValue,
  trackTitleValue,
} from './track-metadata-quality.js';

const MAX_KEYS_PER_TYPE = 80;

function normalizedIsrc(value) {
  return String(value || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

function text(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function placeholders(count) {
  return Array.from({ length: count }, () => '?').join(',');
}

function missingSchema(error) {
  return /no such table|no such column/i.test(String(error?.message || error));
}

async function runRows(db, sql, bindings) {
  if (!db?.prepare || !bindings.length) return [];
  const statement = db.prepare(sql).bind(...bindings);
  if (typeof statement?.all !== 'function') return [];
  const result = await statement.all();
  return result?.results || [];
}

function mergeRow(current, rawRow) {
  const row = sanitizeMetadataRow(rawRow);
  if (!current) return row;
  return {
    ...row,
    ...current,
    title: trackTitleValue(current.title) || trackTitleValue(row.title),
    artist: trackArtistValue(current.artist) || trackArtistValue(row.artist),
    thumbnail_url: current.thumbnail_url || row.thumbnail_url || null,
    fetched_at: Math.max(Number(current.fetched_at || 0), Number(row.fetched_at || 0)) || null,
  };
}

function uniqueRows(rows) {
  const byIdentity = new Map();
  for (const rawRow of rows || []) {
    const row = sanitizeMetadataRow(rawRow);
    const trackId = Number(row?.track_id);
    const spotifyId = text(row?.spotify_id);
    const isrc = normalizedIsrc(row?.isrc);
    if (!Number.isFinite(trackId) && !spotifyId && !isrc) continue;
    const key = Number.isFinite(trackId)
      ? `track:${Math.trunc(trackId)}`
      : (isrc ? `isrc:${isrc}` : `spotify:${spotifyId}`);
    byIdentity.set(key, mergeRow(byIdentity.get(key), { ...row, isrc: isrc || row?.isrc || null }));
  }
  return [...byIdentity.values()];
}

async function canonicalRowsByIsrc(db, isrcs) {
  if (!isrcs.length) return [];
  return runRows(db, `SELECT track_id,spotify_id,isrc,title,artist,thumbnail_url,fetched_at
    FROM sh_track_canonical_metadata
    WHERE isrc IN (${placeholders(isrcs.length)})`, isrcs);
}

async function canonicalRowsBySpotify(db, spotifyIds) {
  if (!spotifyIds.length) return [];
  return runRows(db, `SELECT track_id,spotify_id,isrc,title,artist,thumbnail_url,fetched_at
    FROM sh_track_canonical_metadata
    WHERE spotify_id IN (${placeholders(spotifyIds.length)})`, spotifyIds);
}

/**
 * Read presentation metadata from the single MINUTE_DB canonical view.
 *
 * Source caches such as sh_track_metadata/sh_isrc_metadata and BUDDIES_DB are
 * intentionally excluded here. They may feed sh_track_dictionary, but read
 * models must never merge them independently because that recreates multiple
 * competing truths for title/artist/thumbnail values.
 */
export async function loadReadModelTrackMetadata(env, spotifyIds, isrcs) {
  const requestedSpotifyIds = [...new Set(
    (spotifyIds || []).map(text).filter(Boolean),
  )].slice(0, MAX_KEYS_PER_TYPE);
  const requestedIsrcs = [...new Set(
    (isrcs || []).map(normalizedIsrc).filter(Boolean),
  )].slice(0, MAX_KEYS_PER_TYPE);
  if (!requestedSpotifyIds.length && !requestedIsrcs.length) return [];

  const db = env?.MINUTE_DB;
  if (!db?.prepare) return [];
  try {
    const [byIsrc, bySpotify] = await Promise.all([
      canonicalRowsByIsrc(db, requestedIsrcs),
      canonicalRowsBySpotify(db, requestedSpotifyIds),
    ]);
    return uniqueRows([...byIsrc, ...bySpotify]);
  } catch (error) {
    if (missingSchema(error)) return [];
    throw error;
  }
}
