import {
  sanitizeMetadataRow,
  trackArtistValue,
  trackTitleValue,
} from './track-metadata-quality.js';

const MAX_KEYS_PER_TYPE = 80;
const METADATA_LRU_LIMIT = 2_000;
const METADATA_LRU_TTL_MS = 15 * 60_000;
const CANONICAL_QUERY_UNAVAILABLE = 'canonical metadata query unavailable';
const metadataLru = new Map();

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

function lruKey(type, value) {
  return value == null || value === '' ? null : `${type}:${value}`;
}

function lruGet(key, now = Date.now()) {
  if (!key) return null;
  const entry = metadataLru.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= now) {
    metadataLru.delete(key);
    return null;
  }
  metadataLru.delete(key);
  metadataLru.set(key, entry);
  return entry.row;
}

function lruSet(row, now = Date.now()) {
  if (!row) return;
  const keys = [
    lruKey('track', positiveInteger(row.track_id)),
    lruKey('isrc', normalizedIsrc(row.isrc)),
    lruKey('spotify', text(row.spotify_id)),
  ].filter(Boolean);
  if (!keys.length) return;
  const entry = { row: { ...row }, expiresAt: now + METADATA_LRU_TTL_MS };
  for (const key of keys) {
    metadataLru.delete(key);
    metadataLru.set(key, entry);
  }
  while (metadataLru.size > METADATA_LRU_LIMIT) {
    metadataLru.delete(metadataLru.keys().next().value);
  }
}

function validTrackTitleSql(alias) {
  return `CASE WHEN ${alias}.title IS NULL OR TRIM(${alias}.title)=''
      OR TRIM(${alias}.title)=TRIM(${alias}.spotify_id)
    THEN NULL ELSE TRIM(${alias}.title) END`;
}

function validTrackArtistSql(alias) {
  return `CASE WHEN ${alias}.artist IS NULL OR TRIM(${alias}.artist)=''
      OR TRIM(${alias}.artist)=TRIM(${alias}.spotify_id)
      OR TRIM(${alias}.artist) GLOB 'JP[A-Z0-9]*'
    THEN NULL ELSE TRIM(${alias}.artist) END`;
}

async function directRowsByTrackId(db, trackIds) {
  if (!trackIds.length) return [];
  return runRows(db, `SELECT
      t.id AS track_id,
      COALESCE(NULLIF(TRIM(d.spotify_id),''),NULLIF(TRIM(t.spotify_id),'')) AS spotify_id,
      COALESCE(d.isrc,NULLIF(UPPER(REPLACE(REPLACE(TRIM(t.isrc),'-',''),' ','')),'')) AS isrc,
      COALESCE(NULLIF(TRIM(d.title),''),${validTrackTitleSql('t')}) AS title,
      COALESCE(NULLIF(TRIM(d.artist),''),${validTrackArtistSql('t')}) AS artist,
      d.thumbnail_url,
      CASE WHEN d.isrc IS NOT NULL THEN d.metadata_fetched_at ELSE t.last_seen_at END AS fetched_at
    FROM sh_tracks t
    LEFT JOIN sh_track_dictionary d
      ON d.isrc=UPPER(REPLACE(REPLACE(TRIM(t.isrc),'-',''),' ',''))
    WHERE t.id IN (${placeholders(trackIds.length)})`, trackIds);
}

async function dictionaryRowsByIsrc(db, isrcs) {
  if (!isrcs.length) return [];
  return runRows(db, `SELECT NULL AS track_id,spotify_id,isrc,title,artist,thumbnail_url,
      metadata_fetched_at AS fetched_at
    FROM sh_track_dictionary
    WHERE isrc IN (${placeholders(isrcs.length)})`, isrcs);
}

function mappingValue(row, column) {
  return column === 'isrc' ? normalizedIsrc(row?.isrc) : text(row?.spotify_id);
}

async function trackIdsByProvider(db, values, column) {
  if (!values.length) return [];
  const safeColumn = column === 'isrc' ? 'isrc' : 'spotify_id';
  const direct = await runRows(db, `SELECT id AS track_id,${safeColumn}
    FROM sh_tracks
    WHERE ${safeColumn} IN (${placeholders(values.length)})`, values);
  const found = new Set(direct.map((row) => mappingValue(row, safeColumn)).filter(Boolean));
  const missing = values.filter((value) => !found.has(
    safeColumn === 'isrc' ? normalizedIsrc(value) : text(value),
  ));
  if (!missing.length) return direct;
  const aliases = await runRows(db, `SELECT track_id,alias_value AS ${safeColumn}
    FROM sh_track_aliases
    WHERE alias_type=?
      AND alias_value IN (${placeholders(missing.length)})`, [safeColumn, ...missing]);
  return [...direct, ...aliases];
}

async function dictionaryRowsBySpotify(db, spotifyIds) {
  if (!spotifyIds.length) return [];
  return runRows(db, `SELECT NULL AS track_id,spotify_id,isrc,title,artist,thumbnail_url,
      metadata_fetched_at AS fetched_at
    FROM sh_track_dictionary
    WHERE spotify_id IS NOT NULL AND TRIM(spotify_id)<>''
      AND spotify_id IN (${placeholders(spotifyIds.length)})`, spotifyIds);
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
    trackIds: new Set((rows || []).map((row) => positiveInteger(row?.track_id)).filter(Boolean)),
    isrcs: new Set((rows || []).map((row) => normalizedIsrc(row?.isrc)).filter(Boolean)),
    spotifyIds: new Set((rows || []).map((row) => text(row?.spotify_id)).filter(Boolean)),
  };
}

function cachedRows(requestedTrackIds, requestedSpotifyIds, requestedIsrcs) {
  const rows = [];
  const seen = new Set();
  for (const [type, values] of [
    ['track', requestedTrackIds],
    ['spotify', requestedSpotifyIds],
    ['isrc', requestedIsrcs],
  ]) {
    for (const value of values) {
      const row = lruGet(lruKey(type, value));
      if (!row) continue;
      const key = positiveInteger(row.track_id) != null
        ? `track:${positiveInteger(row.track_id)}`
        : (normalizedIsrc(row.isrc) ? `isrc:${normalizedIsrc(row.isrc)}` : `spotify:${text(row.spotify_id)}`);
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(row);
    }
  }
  return rows;
}

function mappedTrackIds(mappings, covered) {
  return [...new Set((mappings || [])
    .map((row) => positiveInteger(row?.track_id))
    .filter(Boolean))]
    .filter((trackId) => !covered.trackIds.has(trackId));
}

function appendResolved(resolved, rows) {
  if (!rows.length) return resolved;
  rows.forEach((row) => lruSet(row));
  return uniqueRows([...resolved, ...rows]);
}

/**
 * Read presentation metadata from indexed physical MINUTE_DB owners.
 * sh_tracks.id is the primary identity and sh_track_dictionary owns canonical
 * presentation. Provider aliases are used only for unresolved identities; the
 * UNION canonical view is excluded from the steady-state hot path.
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
    let resolved = uniqueRows(cachedRows(requestedTrackIds, requestedSpotifyIds, requestedIsrcs));
    let covered = coveredKeys(resolved);

    const remainingTrackIds = requestedTrackIds.filter((trackId) => !covered.trackIds.has(trackId));
    resolved = appendResolved(resolved, await directRowsByTrackId(db, remainingTrackIds));
    covered = coveredKeys(resolved);

    let remainingIsrcs = requestedIsrcs.filter((isrc) => !covered.isrcs.has(isrc));
    if (remainingIsrcs.length) {
      const isrcMappings = await trackIdsByProvider(db, remainingIsrcs, 'isrc');
      const ids = mappedTrackIds(isrcMappings, covered);
      resolved = appendResolved(resolved, await directRowsByTrackId(db, ids));
      covered = coveredKeys(resolved);
      remainingIsrcs = remainingIsrcs.filter((isrc) => !covered.isrcs.has(isrc));
      resolved = appendResolved(resolved, await dictionaryRowsByIsrc(db, remainingIsrcs));
      covered = coveredKeys(resolved);
    }

    let remainingSpotifyIds = requestedSpotifyIds
      .filter((spotifyId) => !covered.spotifyIds.has(spotifyId));
    if (remainingSpotifyIds.length) {
      const spotifyMappings = await trackIdsByProvider(db, remainingSpotifyIds, 'spotify_id');
      const ids = mappedTrackIds(spotifyMappings, covered);
      resolved = appendResolved(resolved, await directRowsByTrackId(db, ids));
      covered = coveredKeys(resolved);
      remainingSpotifyIds = remainingSpotifyIds
        .filter((spotifyId) => !covered.spotifyIds.has(spotifyId));
    }

    resolved = appendResolved(resolved, await dictionaryRowsBySpotify(db, remainingSpotifyIds));
    return uniqueRows(resolved);
  } catch (error) {
    if (!canonicalUnavailable(error)) throw error;
    const fallback = env?.BUDDIES_DB;
    if (!fallback || fallback === db) return [];
    return legacyRowsDuringMigration(fallback, requestedSpotifyIds, requestedIsrcs);
  }
}
