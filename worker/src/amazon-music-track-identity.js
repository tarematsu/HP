import { chunks, text } from './minute-facts-track-descriptor.js';
import { resolveTracksAliasFirst } from './minute-track-resolution-optimized.js';
import {
  attachTitleArtistIdentity,
  loadTitleArtistIdentityRows,
} from './track-title-artist-identity.js';

const AMAZON_ALIAS_TYPE = 'amazon_music_id';
const ALIAS_LOOKUP_CHUNK_SIZE = 79;
const TRACK_LOOKUP_CHUNK_SIZE = 79;
const REPAIR_BATCH_SIZE = 20;
const TITLE_ARTIST_LOOKUP_CHUNK_SIZE = 40;

function normalizedIsrc(value) {
  return text(value)?.toUpperCase() || null;
}

function normalizedIdentityText(value) {
  return text(value)?.normalize('NFKC').replace(/\s+/g, ' ').toLowerCase() || null;
}

function amazonMusicId(track = {}) {
  return text(
    track.amazonMusicId
    ?? track.amazon_music_id
    ?? track.amazonTrackId
    ?? track.amazon_track_id,
  );
}

function normalizedTrack(track = {}, position = 0) {
  return {
    position,
    amazon_music_id: amazonMusicId(track),
    isrc: normalizedIsrc(track.isrc),
    title: text(track.title),
    artist: text(track.artist),
  };
}

async function loadKnownAmazonAliases(db, amazonIds) {
  const result = new Map();
  for (const part of chunks([...new Set(amazonIds.filter(Boolean))], ALIAS_LOOKUP_CHUNK_SIZE)) {
    const placeholders = part.map(() => '?').join(',');
    const rows = await db.prepare(`SELECT alias_value,track_id
      FROM sh_track_aliases
      WHERE alias_type='${AMAZON_ALIAS_TYPE}'
        AND alias_value IN (${placeholders})`)
      .bind(...part).all();
    for (const row of rows?.results || []) {
      const id = Number(row?.track_id);
      const value = text(row?.alias_value);
      if (value && Number.isSafeInteger(id) && id > 0) result.set(value, id);
    }
  }
  return result;
}

async function loadKnownTrackRows(db, trackIds) {
  const result = new Map();
  const ids = [...new Set(trackIds
    .map((value) => Number(value))
    .filter((value) => Number.isSafeInteger(value) && value > 0))];
  for (const part of chunks(ids, TRACK_LOOKUP_CHUNK_SIZE)) {
    const placeholders = part.map(() => '?').join(',');
    const rows = await db.prepare(`SELECT id,title,artist,isrc
      FROM sh_tracks WHERE id IN (${placeholders})`)
      .bind(...part).all();
    for (const row of rows?.results || []) {
      const id = Number(row?.id);
      if (Number.isSafeInteger(id) && id > 0) result.set(id, row);
    }
  }
  return result;
}

function compatibleKnownTrack(track, known) {
  if (!known) return true;
  const incomingTitle = normalizedIdentityText(track?.title);
  const knownTitle = normalizedIdentityText(known?.title);
  if (incomingTitle && knownTitle && incomingTitle !== knownTitle) return false;
  const incomingArtist = normalizedIdentityText(track?.artist);
  const knownArtist = normalizedIdentityText(known?.artist);
  if (incomingArtist && knownArtist && incomingArtist !== knownArtist) return false;
  return true;
}

async function hydrateUniqueIsrcFromLocalMetadata(db, tracks) {
  const candidates = tracks.filter((track) => !track.trackId && !track.isrc && track.title && track.artist);
  if (!candidates.length) return;

  // Cloudflare D1 has a much lower bind-variable ceiling than desktop SQLite.
  // loadTitleArtistIdentityRows may emit both original and NFKC title variants,
  // so keep each lookup well below the limit while still covering every track.
  const rows = [];
  for (const part of chunks(candidates, TITLE_ARTIST_LOOKUP_CHUNK_SIZE)) {
    rows.push(...await loadTitleArtistIdentityRows(db, part, part.length));
  }
  if (!rows.length) return;

  const hydrated = attachTitleArtistIdentity(candidates, rows);
  const byPosition = new Map(hydrated
    .filter((track) => normalizedIsrc(track?.isrc))
    .map((track) => [track.position, normalizedIsrc(track.isrc)]));
  for (const track of tracks) {
    const isrc = byPosition.get(track.position);
    if (isrc) track.isrc = isrc;
  }
}

async function repairAmazonAliasConflicts(db, resolved, observedAt) {
  const statements = resolved
    .filter((track) => track.amazon_music_id && Number.isSafeInteger(Number(track.trackId)))
    .map((track) => {
      const trackId = Number(track.trackId);
      return db.prepare(`UPDATE sh_track_aliases SET
          track_id=?,last_seen_at=MAX(last_seen_at,?)
        WHERE alias_type='${AMAZON_ALIAS_TYPE}' AND alias_value=? AND track_id<>?`)
        .bind(trackId, observedAt, track.amazon_music_id, trackId);
    });
  for (const part of chunks(statements, REPAIR_BATCH_SIZE)) {
    if (part.length) await db.batch(part);
  }
}

export async function resolveAmazonMusicTracks(db, tracks, observedAt = Date.now()) {
  if (!db?.prepare || !Array.isArray(tracks) || !tracks.length) return [];

  const normalized = tracks.map((track, index) => normalizedTrack(track, index));
  const knownAliases = await loadKnownAmazonAliases(
    db,
    normalized.map((track) => track.amazon_music_id),
  );
  const knownTrackRows = await loadKnownTrackRows(db, [...knownAliases.values()]);

  // Amazon aliases are cached identity hints, not authority. If the current
  // Amazon title/artist clearly disagrees with the linked sh_tracks row, drop
  // the stale link and resolve again from the exact title/artist -> ISRC path.
  const result = normalized.map((track) => {
    const trackId = track.amazon_music_id ? (knownAliases.get(track.amazon_music_id) ?? null) : null;
    const known = trackId == null ? null : knownTrackRows.get(Number(trackId));
    return {
      ...track,
      trackId: trackId != null && compatibleKnownTrack(track, known) ? trackId : null,
    };
  });

  // Amazon's current anonymous Web Player does not expose ISRC on catalog-track
  // detail responses. Reuse the existing metadata dictionary only when title +
  // artist resolves to one compatible ISRC. Ambiguous matches stay unresolved.
  await hydrateUniqueIsrcFromLocalMetadata(db, result);

  const firstSeenWithIsrc = [];
  const firstSeenIndexes = [];
  for (let index = 0; index < result.length; index += 1) {
    const track = result[index];
    if (!track.amazon_music_id || !track.isrc) continue;
    firstSeenIndexes.push(index);
    firstSeenWithIsrc.push(track);
  }

  if (firstSeenWithIsrc.length) {
    // ISRC is the authority for first linkage. Amazon IDs are aliases only, so
    // they never create a parallel song identity by themselves.
    const resolved = await resolveTracksAliasFirst(db, null, firstSeenWithIsrc, observedAt);
    await repairAmazonAliasConflicts(db, resolved, observedAt);
    for (let offset = 0; offset < resolved.length; offset += 1) {
      result[firstSeenIndexes[offset]] = resolved[offset];
    }
  }

  return result;
}
