import {
  trackArtistValue,
  trackTitleValue,
} from './track-metadata-quality.js';

function text(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function normalizedIsrc(value) {
  const normalized = String(value || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(normalized) ? normalized : null;
}

function normalizedName(value, type) {
  const usable = type === 'title' ? trackTitleValue(value) : trackArtistValue(value);
  if (!usable) return null;
  return usable
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function trackTitleArtistKey(value) {
  const title = normalizedName(value?.title, 'title');
  const artist = normalizedName(value?.artist, 'artist');
  return title && artist ? `${title}\u001f${artist}` : null;
}

function titleVariants(tracks, limit) {
  const result = new Set();
  for (const track of tracks || []) {
    if (result.size >= limit * 2) break;
    const title = trackTitleValue(track?.title);
    const artist = trackArtistValue(track?.artist);
    if (!title || !artist) continue;
    if (text(track?.spotify_id) || normalizedIsrc(track?.isrc)) continue;
    result.add(title);
    result.add(title.normalize('NFKC'));
  }
  return [...result].filter(Boolean).slice(0, limit * 2);
}

function placeholders(count) {
  return Array.from({ length: count }, () => '?').join(',');
}

function missingSchema(error) {
  return /no such table|no such column/i.test(String(error?.message || error));
}

async function safeRows(db, sql, bindings) {
  if (!db?.prepare || !bindings.length) return [];
  try {
    const statement = db.prepare(sql).bind(...bindings);
    if (typeof statement?.all !== 'function') return [];
    const result = await statement.all();
    return result?.results || [];
  } catch (error) {
    if (missingSchema(error)) return [];
    throw error;
  }
}

async function candidateRows(db, titles) {
  if (!titles.length) return [];
  const marks = placeholders(titles.length);
  const where = `WHERE title IS NOT NULL AND artist IS NOT NULL
      AND TRIM(title) COLLATE NOCASE IN (${marks})`;
  const rows = [];
  rows.push(...await safeRows(db, `SELECT spotify_id,isrc,title,artist,
      NULL AS thumbnail_url,last_seen_at AS fetched_at
    FROM sh_tracks ${where}`, titles));
  rows.push(...await safeRows(db, `SELECT spotify_id,isrc,title,artist,
      thumbnail_url,fetched_at
    FROM sh_track_metadata ${where}`, titles));
  rows.push(...await safeRows(db, `SELECT spotify_id,isrc,title,artist,
      thumbnail_url,metadata_fetched_at AS fetched_at
    FROM sh_track_dictionary ${where}`, titles));
  rows.push(...await safeRows(db, `SELECT NULL AS spotify_id,isrc,title,artist,
      NULL AS thumbnail_url,fetched_at
    FROM sh_isrc_metadata ${where}`, titles));
  return rows;
}

function requestedKeys(tracks, limit) {
  const result = new Map();
  for (const track of tracks || []) {
    if (result.size >= limit) break;
    if (text(track?.spotify_id) || normalizedIsrc(track?.isrc)) continue;
    const key = trackTitleArtistKey(track);
    if (!key || result.has(key)) continue;
    result.set(key, {
      title: trackTitleValue(track?.title),
      artist: trackArtistValue(track?.artist),
    });
  }
  return result;
}

function resolveRows(tracks, rows, limit) {
  const requested = requestedKeys(tracks, limit);
  if (!requested.size) return [];
  const candidates = new Map();
  for (const row of rows || []) {
    const key = trackTitleArtistKey(row);
    if (!key || !requested.has(key)) continue;
    if (!candidates.has(key)) candidates.set(key, []);
    candidates.get(key).push(row);
  }

  const resolved = [];
  for (const [key, request] of requested) {
    const matches = candidates.get(key) || [];
    const spotifyIds = new Set(matches.map((row) => text(row?.spotify_id)).filter(Boolean));
    const isrcs = new Set(matches.map((row) => normalizedIsrc(row?.isrc)).filter(Boolean));
    const spotifyId = spotifyIds.size === 1 ? [...spotifyIds][0] : null;
    const isrc = isrcs.size === 1 ? [...isrcs][0] : null;
    if (!spotifyId && !isrc) continue;

    const compatible = matches.filter((row) => {
      const rowSpotify = text(row?.spotify_id);
      const rowIsrc = normalizedIsrc(row?.isrc);
      return (!spotifyId || !rowSpotify || rowSpotify === spotifyId)
        && (!isrc || !rowIsrc || rowIsrc === isrc);
    }).sort((left, right) => {
      const leftScore = Number(Boolean(left?.thumbnail_url)) * 1_000_000
        + Number(left?.fetched_at || 0);
      const rightScore = Number(Boolean(right?.thumbnail_url)) * 1_000_000
        + Number(right?.fetched_at || 0);
      return rightScore - leftScore;
    });
    const best = compatible[0] || matches[0] || {};
    resolved.push({
      title: request.title,
      artist: request.artist,
      spotify_id: spotifyId,
      isrc,
      thumbnail_url: text(best?.thumbnail_url),
      fetched_at: Number(best?.fetched_at || 0) || null,
      title_artist_identity: key,
    });
  }
  return resolved;
}

export async function loadTitleArtistIdentityRows(databases, tracks, limit = 80) {
  const boundedLimit = Math.max(1, Math.trunc(Number(limit) || 80));
  const titles = titleVariants(tracks, boundedLimit);
  if (!titles.length) return [];
  const sources = Array.isArray(databases) ? databases : [databases];
  const rows = [];
  const seen = new Set();
  for (const db of sources) {
    if (!db || seen.has(db)) continue;
    seen.add(db);
    rows.push(...await candidateRows(db, titles));
  }
  return resolveRows(tracks, rows, boundedLimit);
}

export function attachTitleArtistIdentity(tracks, rows = []) {
  if (!Array.isArray(tracks) || !tracks.length || !rows.length) return tracks;
  const byKey = new Map();
  for (const row of rows) {
    const key = row?.title_artist_identity || trackTitleArtistKey(row);
    if (key) byKey.set(key, row);
  }
  let changed = false;
  const result = tracks.map((track) => {
    if (!track || typeof track !== 'object') return track;
    if (text(track.spotify_id) || normalizedIsrc(track.isrc)) return track;
    const row = byKey.get(trackTitleArtistKey(track));
    if (!row) return track;
    const spotifyId = text(row.spotify_id);
    const isrc = normalizedIsrc(row.isrc);
    const thumbnailUrl = text(track.thumbnail_url) || text(row.thumbnail_url);
    if (!spotifyId && !isrc && thumbnailUrl === text(track.thumbnail_url)) return track;
    changed = true;
    return {
      ...track,
      ...(spotifyId ? { spotify_id: spotifyId } : {}),
      ...(isrc ? { isrc } : {}),
      ...(thumbnailUrl ? { thumbnail_url: thumbnailUrl } : {}),
    };
  });
  return changed ? result : tracks;
}
