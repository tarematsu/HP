import { loadReadModelTrackMetadata } from './read-model-metadata-indexed.js';
import {
  sanitizeMetadataRow,
  trackArtistValue,
  trackNeedsHydration,
  trackTitleValue,
} from './track-metadata-quality.js';

function text(value) {
  const result = String(value ?? '').trim();
  return result || null;
}

function integer(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

function normalizedIsrc(value) {
  return String(value || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

function placeholders(count) {
  return Array.from({ length: count }, () => '?').join(',');
}

function missingSchema(error) {
  return /no such table|no such column/i.test(String(error?.message || error));
}

function mergeRow(current, rawRow) {
  const row = sanitizeMetadataRow(rawRow);
  if (!row) return current;
  if (!current) return { ...row };
  return {
    ...row,
    ...current,
    position: integer(current.position) ?? integer(row.position),
    queue_track_id: integer(current.queue_track_id) ?? integer(row.queue_track_id),
    stationhead_track_id: integer(current.stationhead_track_id)
      ?? integer(row.stationhead_track_id),
    spotify_id: text(current.spotify_id) || text(row.spotify_id),
    isrc: normalizedIsrc(current.isrc) || normalizedIsrc(row.isrc) || null,
    title: trackTitleValue(current.title) || trackTitleValue(row.title),
    artist: trackArtistValue(current.artist) || trackArtistValue(row.artist),
    album_name: text(current.album_name) || text(row.album_name),
    thumbnail_url: text(current.thumbnail_url) || text(row.thumbnail_url),
    fetched_at: Math.max(Number(current.fetched_at || 0), Number(row.fetched_at || 0)) || null,
  };
}

async function stationheadRows(db, stationheadTrackIds) {
  if (!db?.prepare || !stationheadTrackIds.length) return [];
  try {
    const statement = db.prepare(`SELECT stationhead_track_id,spotify_id,isrc,title,artist,
        NULL AS album_name,NULL AS thumbnail_url,last_seen_at AS fetched_at
      FROM sh_tracks
      WHERE stationhead_track_id IN (${placeholders(stationheadTrackIds.length)})
      ORDER BY last_seen_at DESC`).bind(...stationheadTrackIds);
    if (typeof statement?.all !== 'function') return [];
    const result = await statement.all();
    return result?.results || [];
  } catch (error) {
    if (missingSchema(error)) return [];
    throw error;
  }
}

async function latestQueueIdentityRows(db, positions) {
  if (!db?.prepare || !positions.length) return [];
  try {
    const statement = db.prepare(`WITH latest_queue AS (
        SELECT station_id,start_time
        FROM sh_queue_current
        WHERE station_id IS NOT NULL AND start_time IS NOT NULL
        ORDER BY observed_at DESC
        LIMIT 1
      )
      SELECT q.position,q.queue_track_id,q.stationhead_track_id,q.spotify_id,q.isrc,
        NULL AS title,NULL AS artist,NULL AS album_name,NULL AS thumbnail_url,
        q.observed_at AS fetched_at
      FROM latest_queue l
      JOIN sh_queue_items q
        ON q.station_id=l.station_id AND q.start_time=l.start_time
      WHERE q.position IN (${placeholders(positions.length)})
      ORDER BY q.observed_at DESC`).bind(...positions);
    if (typeof statement?.all !== 'function') return [];
    const result = await statement.all();
    return result?.results || [];
  } catch (error) {
    if (missingSchema(error)) return [];
    throw error;
  }
}

function collectKeys(tracks, limit) {
  const spotifyIds = new Set();
  const isrcs = new Set();
  const stationheadTrackIds = new Set();
  const positions = new Set();
  for (let index = 0; index < (tracks || []).length; index += 1) {
    const track = tracks[index];
    if (!track || !trackNeedsHydration(track)) continue;
    const spotifyId = text(track.spotify_id);
    const isrc = normalizedIsrc(track.isrc);
    const stationheadTrackId = integer(track.stationhead_track_id);

    if (spotifyIds.size < limit && spotifyId) spotifyIds.add(spotifyId);
    if (isrcs.size < limit && isrc) isrcs.add(isrc);
    if (stationheadTrackIds.size < limit && stationheadTrackId != null) {
      stationheadTrackIds.add(stationheadTrackId);
    }
    if (!spotifyId && !isrc && stationheadTrackId == null && positions.size < limit) {
      positions.add(integer(track.position) ?? index);
    }
    if (spotifyIds.size === limit
        && isrcs.size === limit
        && stationheadTrackIds.size === limit
        && positions.size === limit) break;
  }
  return { spotifyIds, isrcs, stationheadTrackIds, positions };
}

function mergeIdentityRows(rows) {
  const byStationhead = new Map();
  for (const rawRow of rows || []) {
    const id = integer(rawRow?.stationhead_track_id);
    if (id == null) continue;
    byStationhead.set(id, mergeRow(byStationhead.get(id), rawRow));
  }
  return [...byStationhead.values()];
}

function mergeQueueIdentityRows(rows) {
  const byPosition = new Map();
  for (const rawRow of rows || []) {
    const position = integer(rawRow?.position);
    if (position == null) continue;
    byPosition.set(position, mergeRow(byPosition.get(position), rawRow));
  }
  return [...byPosition.values()];
}

function enrichIdentityRows(identityRows, metadataRows) {
  const bySpotify = new Map();
  const byIsrc = new Map();
  for (const row of metadataRows || []) {
    const spotifyId = text(row?.spotify_id);
    const isrc = normalizedIsrc(row?.isrc);
    if (spotifyId) bySpotify.set(spotifyId, mergeRow(bySpotify.get(spotifyId), row));
    if (isrc) byIsrc.set(isrc, mergeRow(byIsrc.get(isrc), row));
  }
  return identityRows.map((row) => {
    const byIsrcRow = byIsrc.get(normalizedIsrc(row?.isrc));
    const bySpotifyRow = bySpotify.get(text(row?.spotify_id));
    let enriched = row;
    if (bySpotifyRow) enriched = mergeRow(enriched, bySpotifyRow);
    if (byIsrcRow) enriched = mergeRow(enriched, byIsrcRow);
    return enriched;
  });
}

export async function loadPlaybackReadModelTrackMetadata(env, tracks, limit = 80) {
  const boundedLimit = Math.max(1, Math.trunc(Number(limit) || 80));
  const keys = collectKeys(tracks, boundedLimit);
  if (!keys.spotifyIds.size && !keys.isrcs.size
      && !keys.stationheadTrackIds.size && !keys.positions.size) return [];

  const positions = [...keys.positions];
  const localQueueRows = await latestQueueIdentityRows(env?.MINUTE_DB, positions);
  const sourceQueueRows = env?.BUDDIES_DB && env.BUDDIES_DB !== env.MINUTE_DB
    ? await latestQueueIdentityRows(env.BUDDIES_DB, positions)
    : [];
  const queueIdentityRows = mergeQueueIdentityRows([...localQueueRows, ...sourceQueueRows]);
  for (const row of queueIdentityRows) {
    const stationheadTrackId = integer(row.stationhead_track_id);
    const spotifyId = text(row.spotify_id);
    const isrc = normalizedIsrc(row.isrc);
    if (stationheadTrackId != null && keys.stationheadTrackIds.size < boundedLimit) {
      keys.stationheadTrackIds.add(stationheadTrackId);
    }
    if (spotifyId && keys.spotifyIds.size < boundedLimit) keys.spotifyIds.add(spotifyId);
    if (isrc && keys.isrcs.size < boundedLimit) keys.isrcs.add(isrc);
  }

  const stationheadIds = [...keys.stationheadTrackIds];
  const localIdentityRows = await stationheadRows(env?.MINUTE_DB, stationheadIds);
  const sourceIdentityRows = env?.BUDDIES_DB && env.BUDDIES_DB !== env.MINUTE_DB
    ? await stationheadRows(env.BUDDIES_DB, stationheadIds)
    : [];
  const stationheadIdentityRows = mergeIdentityRows([...localIdentityRows, ...sourceIdentityRows]);

  for (const row of stationheadIdentityRows) {
    const spotifyId = text(row.spotify_id);
    const isrc = normalizedIsrc(row.isrc);
    if (spotifyId && keys.spotifyIds.size < boundedLimit) keys.spotifyIds.add(spotifyId);
    if (isrc && keys.isrcs.size < boundedLimit) keys.isrcs.add(isrc);
  }

  const metadataRows = (keys.spotifyIds.size || keys.isrcs.size)
    ? await loadReadModelTrackMetadata(env, [...keys.spotifyIds], [...keys.isrcs])
    : [];
  const identityRows = [...queueIdentityRows, ...stationheadIdentityRows];
  const enrichedIdentityRows = enrichIdentityRows(identityRows, metadataRows);
  return [...enrichedIdentityRows, ...metadataRows];
}

export function attachPlaybackReadModelTrackMetadata(queue, rows = []) {
  if (!queue?.tracks?.length || !rows?.length) return queue;

  const byPosition = new Map();
  const byQueueTrack = new Map();
  const byStationhead = new Map();
  const bySpotify = new Map();
  const byIsrc = new Map();
  for (const rawRow of rows) {
    const row = sanitizeMetadataRow(rawRow);
    const position = integer(row?.position);
    const queueTrackId = integer(row?.queue_track_id);
    const stationheadTrackId = integer(row?.stationhead_track_id);
    const spotifyId = text(row?.spotify_id);
    const isrc = normalizedIsrc(row?.isrc);
    if (position != null) byPosition.set(position, mergeRow(byPosition.get(position), row));
    if (queueTrackId != null) byQueueTrack.set(queueTrackId, mergeRow(byQueueTrack.get(queueTrackId), row));
    if (stationheadTrackId != null) {
      byStationhead.set(stationheadTrackId, mergeRow(byStationhead.get(stationheadTrackId), row));
    }
    if (spotifyId) bySpotify.set(spotifyId, mergeRow(bySpotify.get(spotifyId), row));
    if (isrc) byIsrc.set(isrc, mergeRow(byIsrc.get(isrc), row));
  }

  let changed = false;
  const tracks = queue.tracks.map((track, index) => {
    if (!track || typeof track !== 'object') return track;
    const position = integer(track.position) ?? index;
    const queueTrackId = integer(track.queue_track_id);
    const stationheadTrackId = integer(track.stationhead_track_id);
    const spotifyId = text(track.spotify_id);
    const isrc = normalizedIsrc(track.isrc);
    let metadata = mergeRow(null, byPosition.get(position));
    if (queueTrackId != null) metadata = mergeRow(metadata, byQueueTrack.get(queueTrackId));
    if (isrc) metadata = mergeRow(metadata, byIsrc.get(isrc));
    if (spotifyId) metadata = mergeRow(metadata, bySpotify.get(spotifyId));
    if (stationheadTrackId != null) metadata = mergeRow(metadata, byStationhead.get(stationheadTrackId));
    if (!metadata) return track;

    const title = trackTitleValue(track.title) || trackTitleValue(metadata.title);
    const artist = trackArtistValue(track.artist) || trackArtistValue(metadata.artist);
    const albumName = text(track.album_name) || text(metadata.album_name);
    const thumbnailUrl = text(track.thumbnail_url) || text(metadata.thumbnail_url);
    const resolvedQueueTrackId = queueTrackId ?? integer(metadata.queue_track_id);
    const resolvedStationheadTrackId = stationheadTrackId ?? integer(metadata.stationhead_track_id);
    const resolvedSpotifyId = spotifyId || text(metadata.spotify_id);
    const resolvedIsrc = isrc || normalizedIsrc(metadata.isrc) || null;

    if (title === track.title
        && artist === track.artist
        && albumName === track.album_name
        && thumbnailUrl === track.thumbnail_url
        && resolvedQueueTrackId === track.queue_track_id
        && resolvedStationheadTrackId === track.stationhead_track_id
        && resolvedSpotifyId === track.spotify_id
        && resolvedIsrc === track.isrc) return track;

    changed = true;
    return {
      ...track,
      title,
      artist,
      album_name: albumName,
      thumbnail_url: thumbnailUrl,
      queue_track_id: resolvedQueueTrackId,
      stationhead_track_id: resolvedStationheadTrackId,
      spotify_id: resolvedSpotifyId,
      isrc: resolvedIsrc,
    };
  });

  return changed ? { ...queue, tracks } : queue;
}
