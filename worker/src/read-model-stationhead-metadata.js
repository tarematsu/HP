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

function collectKeys(tracks, limit) {
  const spotifyIds = new Set();
  const isrcs = new Set();
  const stationheadTrackIds = new Set();
  for (const track of tracks || []) {
    if (!track || !trackNeedsHydration(track)) continue;
    if (spotifyIds.size < limit) {
      const spotifyId = text(track.spotify_id);
      if (spotifyId) spotifyIds.add(spotifyId);
    }
    if (isrcs.size < limit) {
      const isrc = normalizedIsrc(track.isrc);
      if (isrc) isrcs.add(isrc);
    }
    if (stationheadTrackIds.size < limit) {
      const stationheadTrackId = integer(track.stationhead_track_id);
      if (stationheadTrackId != null) stationheadTrackIds.add(stationheadTrackId);
    }
    if (spotifyIds.size === limit
        && isrcs.size === limit
        && stationheadTrackIds.size === limit) break;
  }
  return { spotifyIds, isrcs, stationheadTrackIds };
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

export async function loadPlaybackReadModelTrackMetadata(env, tracks, limit = 80) {
  const keys = collectKeys(tracks, Math.max(1, Math.trunc(Number(limit) || 80)));
  if (!keys.spotifyIds.size && !keys.isrcs.size && !keys.stationheadTrackIds.size) return [];

  const stationheadIds = [...keys.stationheadTrackIds];
  const localIdentityRows = await stationheadRows(env?.MINUTE_DB, stationheadIds);
  const sourceIdentityRows = env?.BUDDIES_DB && env.BUDDIES_DB !== env.MINUTE_DB
    ? await stationheadRows(env.BUDDIES_DB, stationheadIds)
    : [];
  const identityRows = mergeIdentityRows([...localIdentityRows, ...sourceIdentityRows]);

  for (const row of identityRows) {
    const spotifyId = text(row.spotify_id);
    const isrc = normalizedIsrc(row.isrc);
    if (spotifyId && keys.spotifyIds.size < limit) keys.spotifyIds.add(spotifyId);
    if (isrc && keys.isrcs.size < limit) keys.isrcs.add(isrc);
  }

  const metadataRows = (keys.spotifyIds.size || keys.isrcs.size)
    ? await loadReadModelTrackMetadata(env, [...keys.spotifyIds], [...keys.isrcs])
    : [];
  return [...identityRows, ...metadataRows];
}

export function attachPlaybackReadModelTrackMetadata(queue, rows = []) {
  if (!queue?.tracks?.length || !rows?.length) return queue;

  const byStationhead = new Map();
  const bySpotify = new Map();
  const byIsrc = new Map();
  for (const rawRow of rows) {
    const row = sanitizeMetadataRow(rawRow);
    const stationheadTrackId = integer(row?.stationhead_track_id);
    const spotifyId = text(row?.spotify_id);
    const isrc = normalizedIsrc(row?.isrc);
    if (stationheadTrackId != null) {
      byStationhead.set(stationheadTrackId, mergeRow(byStationhead.get(stationheadTrackId), row));
    }
    if (spotifyId) bySpotify.set(spotifyId, mergeRow(bySpotify.get(spotifyId), row));
    if (isrc) byIsrc.set(isrc, mergeRow(byIsrc.get(isrc), row));
  }

  let changed = false;
  const tracks = queue.tracks.map((track) => {
    if (!track || typeof track !== 'object') return track;
    const stationheadTrackId = integer(track.stationhead_track_id);
    const spotifyId = text(track.spotify_id);
    const isrc = normalizedIsrc(track.isrc);
    let metadata = null;
    if (isrc) metadata = mergeRow(metadata, byIsrc.get(isrc));
    if (spotifyId) metadata = mergeRow(metadata, bySpotify.get(spotifyId));
    if (stationheadTrackId != null) metadata = mergeRow(metadata, byStationhead.get(stationheadTrackId));
    if (!metadata) return track;

    const title = trackTitleValue(track.title) || trackTitleValue(metadata.title);
    const artist = trackArtistValue(track.artist) || trackArtistValue(metadata.artist);
    const albumName = text(track.album_name) || text(metadata.album_name);
    const thumbnailUrl = text(track.thumbnail_url) || text(metadata.thumbnail_url);
    const resolvedSpotifyId = spotifyId || text(metadata.spotify_id);
    const resolvedIsrc = isrc || normalizedIsrc(metadata.isrc) || null;

    if (title === track.title
        && artist === track.artist
        && albumName === track.album_name
        && thumbnailUrl === track.thumbnail_url
        && resolvedSpotifyId === track.spotify_id
        && resolvedIsrc === track.isrc) return track;

    changed = true;
    return {
      ...track,
      title,
      artist,
      album_name: albumName,
      thumbnail_url: thumbnailUrl,
      spotify_id: resolvedSpotifyId,
      isrc: resolvedIsrc,
    };
  });

  return changed ? { ...queue, tracks } : queue;
}
