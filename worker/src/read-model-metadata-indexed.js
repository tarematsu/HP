import {
  sanitizeMetadataRow,
  trackArtistValue,
  trackTitleValue,
} from './track-metadata-quality.js';

const MAX_KEYS_PER_TYPE = 80;
const CANONICAL_QUERY_UNAVAILABLE = 'canonical metadata query unavailable';

function positiveInteger(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

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

function numberedPlaceholders(count, start = 1) {
  return Array.from({ length: count }, (_, index) => `?${start + index}`).join(',');
}

function missingSchema(error) {
  return /no such table|no such column/i.test(String(error?.message || error));
}

function canonicalUnavailable(error) {
  return missingSchema(error)
    || String(error?.message || error).includes(CANONICAL_QUERY_UNAVAILABLE);
}

async function runRows(db, sql, bindings) {
  if (!db?.prepare || !bindings.length) return [];
  const statement = db.prepare(sql).bind(...bindings);
  if (typeof statement?.all !== 'function') throw new Error(CANONICAL_QUERY_UNAVAILABLE);
  const result = await statement.all();
  return result?.results || [];
}

function mergeRow(current, rawRow) {
  const row = sanitizeMetadataRow(rawRow);
  if (!current) return row;
  return {
    ...row,
    ...current,
    track_id: positiveInteger(current.track_id) ?? positiveInteger(row.track_id),
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
    const trackId = positiveInteger(row?.track_id);
    const spotifyId = text(row?.spotify_id);
    const isrc = normalizedIsrc(row?.isrc);
    if (trackId == null && !spotifyId && !isrc) continue;
    const key = trackId != null
      ? `track:${trackId}`
      : (isrc ? `isrc:${isrc}` : `spotify:${spotifyId}`);
    byIdentity.set(key, mergeRow(byIdentity.get(key), {
      ...row,
      track_id: trackId,
      isrc: isrc || row?.isrc || null,
    }));
  }
  return [...byIdentity.values()];
}

async function canonicalRowsByTrackId(db, trackIds) {
  if (!trackIds.length) return [];
  return runRows(db, `SELECT track_id,spotify_id,isrc,title,artist,thumbnail_url,fetched_at
    FROM sh_track_canonical_metadata
    WHERE track_id IN (${placeholders(trackIds.length)})`, trackIds);
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

async function legacyRowsDuringMigration(db, spotifyIds, isrcs) {
  if (!db?.prepare) return [];
  const clauses = [];
  const bindings = [];
  if (isrcs.length) {
    clauses.push(`isrc IN (${numberedPlaceholders(isrcs.length, bindings.length + 1)})`);
    bindings.push(...isrcs);
  }
  if (spotifyIds.length) {
    clauses.push(`spotify_id IN (${numberedPlaceholders(spotifyIds.length, bindings.length + 1)})`);
    bindings.push(...spotifyIds);
  }
  if (!clauses.length) return [];
  try {
    return uniqueRows(await runRows(db, `SELECT NULL AS track_id,spotify_id,isrc,title,artist,thumbnail_url,fetched_at
      FROM sh_track_metadata
      WHERE ${clauses.join(' OR ')}
      ORDER BY fetched_at DESC`, bindings));
  } catch (error) {
    if (!missingSchema(error)) throw error;
    if (!spotifyIds.length) return [];
    const marks = numberedPlaceholders(spotifyIds.length);
    try {
      return uniqueRows(await runRows(db, `SELECT NULL AS track_id,spotify_id,NULL AS isrc,title,artist,thumbnail_url,fetched_at
        FROM sh_track_metadata WHERE spotify_id IN (${marks}) ORDER BY fetched_at DESC`, spotifyIds));
    } catch (legacyError) {
      if (missingSchema(legacyError)) return [];
      throw legacyError;
    }
  }
}

function coveredKeys(rows) {
  return {
    isrcs: new Set((rows || []).map((row) => normalizedIsrc(row?.isrc)).filter(Boolean)),
    spotifyIds: new Set((rows || []).map((row) => text(row?.spotify_id)).filter(Boolean)),
  };
}

/**
 * Read presentation metadata from the single MINUTE_DB canonical view.
 *
 * sh_tracks.id is the primary lookup. Provider identities are bounded alias
 * fallbacks for rows that have not yet been assigned a canonical track id.
 * Source caches are consulted only when the canonical view itself is unavailable
 * during a rolling migration.
 */
export async function loadReadModelTrackMetadata(env, spotifyIds, isrcs, trackIds = []) {
  const requestedTrackIds = [...new Set(
    (trackIds || []).map(positiveInteger).filter(Boolean),
  )].slice(0, MAX_KEYS_PER_TYPE);
  const requestedSpotifyIds = [...new Set(
    (spotifyIds || []).map(text).filter(Boolean),
  )].slice(0, MAX_KEYS_PER_TYPE);
  const requestedIsrcs = [...new Set(
    (isrcs || []).map(normalizedIsrc).filter(Boolean),
  )].slice(0, MAX_KEYS_PER_TYPE);
  if (!requestedTrackIds.length && !requestedSpotifyIds.length && !requestedIsrcs.length) return [];

  const db = env?.MINUTE_DB;
  if (!db?.prepare) return [];
  try {
    // Resolve the strongest identity first, then query only alias keys that are
    // still uncovered. In the common case where callers supply track_id plus
    // provider aliases for the same rows, this turns three canonical view
    // queries into one.
    const byTrackId = await canonicalRowsByTrackId(db, requestedTrackIds);
    let resolved = uniqueRows(byTrackId);
    let covered = coveredKeys(resolved);

    const remainingIsrcs = requestedIsrcs.filter((isrc) => !covered.isrcs.has(isrc));
    const byIsrc = await canonicalRowsByIsrc(db, remainingIsrcs);
    if (byIsrc.length) {
      resolved = uniqueRows([...resolved, ...byIsrc]);
      covered = coveredKeys(resolved);
    }

    const remainingSpotifyIds = requestedSpotifyIds
      .filter((spotifyId) => !covered.spotifyIds.has(spotifyId));
    const bySpotify = await canonicalRowsBySpotify(db, remainingSpotifyIds);
    return uniqueRows([...resolved, ...bySpotify]);
  } catch (error) {
    if (!canonicalUnavailable(error)) throw error;
    const fallback = env?.BUDDIES_DB;
    if (!fallback || fallback === db) return [];
    return legacyRowsDuringMigration(fallback, requestedSpotifyIds, requestedIsrcs);
  }
}
