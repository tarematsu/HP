import { attachStationheadTrackIds } from './spotify-stationhead-identity.js';

const QUERY_CHUNK_SIZE = 80;
const WRITE_CHUNK_SIZE = 50;
const IDENTITY_SEEN_REFRESH_MS = 7 * 24 * 60 * 60 * 1000;
const LEGACY_ALIAS_BOOTSTRAP_KEY = 'legacy-alias-bootstrap-v1';
const LEGACY_ALIAS_BOOTSTRAP_WINDOW = 100;
let aliasBootstrapComplete = false;

function normalizedText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/\s+/gu, ' ')
    .trim();
}

function normalizedArtistIds(artistsJson) {
  let artists;
  try {
    artists = JSON.parse(String(artistsJson || '[]'));
  } catch {
    artists = [];
  }
  return [...new Set(
    (Array.isArray(artists) ? artists : [])
      .map((artist) => (typeof artist === 'string' ? artist : artist?.id))
      .map((id) => String(id || '').trim())
      .filter(Boolean),
  )].sort();
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function rowsOf(result) {
  return Array.isArray(result?.results) ? result.results : [];
}

function chunks(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

async function batchWrites(db, statements) {
  for (const group of chunks(statements, WRITE_CHUNK_SIZE)) {
    if (group.length) await db.batch(group);
  }
}

export function spotifySongKey(track) {
  const sourceTrackId = String(track?.track_id || '').trim();
  const name = normalizedText(track?.name);
  const artistIds = normalizedArtistIds(track?.artists_json);
  if (!name || !artistIds.length) {
    return `track:v2:${sourceTrackId}`;
  }
  return `song:v2:${name}\u001f${artistIds.join(',')}`;
}

async function readKnownAliases(db, keyedTracks) {
  const sourceTrackIds = [...new Set(keyedTracks
    .map(({ track }) => String(track?.track_id || '').trim())
    .filter(Boolean))];
  const aliasBySourceTrackId = new Map();
  for (const group of chunks(sourceTrackIds, QUERY_CHUNK_SIZE)) {
    const placeholders = group.map(() => '?').join(',');
    const result = await db.prepare(`SELECT
        source_track_id,song_key,canonical_track_id,last_seen_at
      FROM sh_spotify_track_aliases
      WHERE source_track_id IN (${placeholders})`)
      .bind(...group)
      .all();
    for (const row of rowsOf(result)) {
      aliasBySourceTrackId.set(String(row.source_track_id), {
        songKey: String(row.song_key || ''),
        canonicalTrackId: String(row.canonical_track_id || ''),
        lastSeenAt: Number(row.last_seen_at || 0),
      });
    }
  }
  return aliasBySourceTrackId;
}

function canonicalizedTrack(track, canonicalTrackId, identityCached) {
  const artistIds = normalizedArtistIds(track?.artists_json);
  return {
    ...track,
    source_track_id: String(track.track_id),
    track_id: canonicalTrackId,
    artists_json: artistIds.length
      ? JSON.stringify(artistIds)
      : String(track?.artists_json || '[]'),
    identity_cached: identityCached,
  };
}

export async function resolveCanonicalSpotifyTracks(db, tracks, seenAt) {
  const keyedTracks = (tracks || []).map((track) => ({
    track,
    songKey: spotifySongKey(track),
  }));
  if (!keyedTracks.length) return [];

  const aliasBySourceTrackId = await readKnownAliases(db, keyedTracks);
  const resolved = new Array(keyedTracks.length);
  const pending = [];
  const refreshCutoff = Number(seenAt) - IDENTITY_SEEN_REFRESH_MS;

  for (const [index, entry] of keyedTracks.entries()) {
    const sourceTrackId = String(entry.track?.track_id || '').trim();
    const alias = aliasBySourceTrackId.get(sourceTrackId);
    const stableAlias = alias
      && alias.songKey === entry.songKey
      && alias.canonicalTrackId
      && Number.isFinite(alias.lastSeenAt)
      && alias.lastSeenAt > refreshCutoff;
    if (stableAlias) {
      resolved[index] = canonicalizedTrack(entry.track, alias.canonicalTrackId, true);
    } else {
      pending.push({ index, ...entry });
    }
  }

  if (!pending.length) return resolved;

  const identifiedTracks = await attachStationheadTrackIds(pending.map(({ track }) => track));
  const pendingKeyedTracks = pending.map((entry, index) => ({
    ...entry,
    track: identifiedTracks[index],
  }));

  const initialCanonicalByKey = new Map();
  for (const { track, songKey } of pendingKeyedTracks) {
    if (!initialCanonicalByKey.has(songKey)) {
      initialCanonicalByKey.set(songKey, String(track.track_id));
    }
  }

  await batchWrites(db, [...initialCanonicalByKey].map(([songKey, trackId]) => (
    db.prepare(`INSERT INTO sh_spotify_song_identities (
        song_key,canonical_track_id,created_at,updated_at
      ) VALUES (?,?,?,?)
      ON CONFLICT(song_key) DO UPDATE SET updated_at=MAX(
        sh_spotify_song_identities.updated_at,excluded.updated_at
      ) WHERE excluded.updated_at>=sh_spotify_song_identities.updated_at+?`)
      .bind(songKey, trackId, seenAt, seenAt, IDENTITY_SEEN_REFRESH_MS)
  )));

  const canonicalByKey = new Map();
  const songKeys = [...initialCanonicalByKey.keys()];
  for (const group of chunks(songKeys, QUERY_CHUNK_SIZE)) {
    const placeholders = group.map(() => '?').join(',');
    const result = await db.prepare(`SELECT song_key,canonical_track_id
      FROM sh_spotify_song_identities WHERE song_key IN (${placeholders})`)
      .bind(...group).all();
    for (const row of rowsOf(result)) {
      canonicalByKey.set(String(row.song_key), String(row.canonical_track_id));
    }
  }
  if (canonicalByKey.size !== songKeys.length) {
    throw new Error('Spotify song identity resolution was incomplete');
  }

  await batchWrites(db, pendingKeyedTracks.map(({ track, songKey }) => {
    const sourceTrackId = String(track.track_id);
    const canonicalTrackId = canonicalByKey.get(songKey);
    const stationheadTrackId = positiveInteger(track?.stationhead_track_id);
    if (stationheadTrackId == null) {
      return db.prepare(`INSERT INTO sh_spotify_track_aliases (
          source_track_id,song_key,canonical_track_id,first_seen_at,last_seen_at
        ) VALUES (?,?,?,?,?)
        ON CONFLICT(source_track_id) DO UPDATE SET
          song_key=excluded.song_key,
          canonical_track_id=excluded.canonical_track_id,
          last_seen_at=MAX(sh_spotify_track_aliases.last_seen_at,excluded.last_seen_at)
        WHERE sh_spotify_track_aliases.song_key<>excluded.song_key
          OR sh_spotify_track_aliases.canonical_track_id<>excluded.canonical_track_id
          OR excluded.last_seen_at>=sh_spotify_track_aliases.last_seen_at+?`)
        .bind(sourceTrackId, songKey, canonicalTrackId, seenAt, seenAt, IDENTITY_SEEN_REFRESH_MS);
    }
    return db.prepare(`INSERT INTO sh_spotify_track_aliases (
        source_track_id,song_key,canonical_track_id,stationhead_track_id,first_seen_at,last_seen_at
      ) VALUES (?,?,?,?,?,?)
      ON CONFLICT(source_track_id) DO UPDATE SET
        song_key=excluded.song_key,
        canonical_track_id=excluded.canonical_track_id,
        stationhead_track_id=excluded.stationhead_track_id,
        last_seen_at=MAX(sh_spotify_track_aliases.last_seen_at,excluded.last_seen_at)
      WHERE sh_spotify_track_aliases.song_key<>excluded.song_key
        OR sh_spotify_track_aliases.canonical_track_id<>excluded.canonical_track_id
        OR sh_spotify_track_aliases.stationhead_track_id IS NOT excluded.stationhead_track_id
        OR excluded.last_seen_at>=sh_spotify_track_aliases.last_seen_at+?`)
      .bind(
        sourceTrackId, songKey, canonicalTrackId, stationheadTrackId,
        seenAt, seenAt, IDENTITY_SEEN_REFRESH_MS,
      );
  }));

  for (const { index, track, songKey } of pendingKeyedTracks) {
    resolved[index] = canonicalizedTrack(track, canonicalByKey.get(songKey), false);
  }
  return resolved;
}

export function resetSpotifyAliasBootstrapVerification() {
  aliasBootstrapComplete = false;
}

export async function bootstrapSpotifyTrackAliases(db, seenAt) {
  if (aliasBootstrapComplete) return 0;

  const state = await db.prepare(`SELECT cursor_track_id,is_complete
    FROM sh_spotify_maintenance_state WHERE maintenance_key=?`)
    .bind(LEGACY_ALIAS_BOOTSTRAP_KEY).first();
  if (!state) throw new Error('Spotify legacy alias bootstrap state is missing');
  if (Number(state.is_complete) === 1) {
    aliasBootstrapComplete = true;
    return 0;
  }

  const cursor = String(state.cursor_track_id || '');
  const result = await db.prepare(`SELECT
      track.track_id,track.name,track.duration_ms,track.artists_json,
      alias.source_track_id AS alias_track_id
    FROM sh_spotify_tracks track
    LEFT JOIN sh_spotify_track_aliases alias ON alias.source_track_id=track.track_id
    WHERE track.track_id>?
    ORDER BY track.track_id
    LIMIT ${LEGACY_ALIAS_BOOTSTRAP_WINDOW}`).bind(cursor).all();
  const window = rowsOf(result);
  const missing = window
    .filter((row) => !String(row.alias_track_id || '').trim())
    .map((row) => ({
      track_id: row.track_id,
      name: row.name,
      duration_ms: row.duration_ms,
      artists_json: row.artists_json,
    }));
  if (missing.length) await resolveCanonicalSpotifyTracks(db, missing, seenAt);

  const nextCursor = window.length ? String(window.at(-1).track_id || cursor) : cursor;
  const complete = window.length < LEGACY_ALIAS_BOOTSTRAP_WINDOW ? 1 : 0;
  await db.prepare(`UPDATE sh_spotify_maintenance_state SET
      cursor_track_id=CASE WHEN cursor_track_id<? THEN ? ELSE cursor_track_id END,
      is_complete=MAX(is_complete,?),updated_at=MAX(updated_at,?)
    WHERE maintenance_key=?`)
    .bind(nextCursor, nextCursor, complete, seenAt, LEGACY_ALIAS_BOOTSTRAP_KEY)
    .run();
  if (complete) aliasBootstrapComplete = true;
  return missing.length;
}
