const QUERY_CHUNK_SIZE = 80;
const WRITE_CHUNK_SIZE = 50;
let aliasBootstrapVerified = false;

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
      .map((artist) => String(artist?.id || '').trim())
      .filter(Boolean),
  )].sort();
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
  const rawDurationMs = track?.duration_ms;
  const durationMs = rawDurationMs == null || rawDurationMs === '' ? Number.NaN : Number(rawDurationMs);
  if (!name || !artistIds.length || !Number.isFinite(durationMs) || durationMs < 0) {
    return `track:v1:${sourceTrackId}`;
  }
  const durationSecond = Math.round(durationMs / 1000);
  return `song:v1:${name}\u001f${artistIds.join(',')}\u001f${durationSecond}`;
}

export async function resolveCanonicalSpotifyTracks(db, tracks, seenAt) {
  const keyedTracks = (tracks || []).map((track) => ({
    track,
    songKey: spotifySongKey(track),
  }));
  if (!keyedTracks.length) return [];

  const initialCanonicalByKey = new Map();
  for (const { track, songKey } of keyedTracks) {
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
      )`)
      .bind(songKey, trackId, seenAt, seenAt)
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

  await batchWrites(db, keyedTracks.map(({ track, songKey }) => {
    const sourceTrackId = String(track.track_id);
    const canonicalTrackId = canonicalByKey.get(songKey);
    return db.prepare(`INSERT INTO sh_spotify_track_aliases (
        source_track_id,song_key,canonical_track_id,first_seen_at,last_seen_at
      ) VALUES (?,?,?,?,?)
      ON CONFLICT(source_track_id) DO UPDATE SET
        song_key=excluded.song_key,
        canonical_track_id=excluded.canonical_track_id,
        last_seen_at=MAX(sh_spotify_track_aliases.last_seen_at,excluded.last_seen_at)`)
      .bind(sourceTrackId, songKey, canonicalTrackId, seenAt, seenAt);
  }));

  return keyedTracks.map(({ track, songKey }) => ({
    ...track,
    source_track_id: String(track.track_id),
    track_id: canonicalByKey.get(songKey),
  }));
}

export function resetSpotifyAliasBootstrapVerification() {
  aliasBootstrapVerified = false;
}

export async function bootstrapSpotifyTrackAliases(db, seenAt) {
  if (aliasBootstrapVerified) return 0;

  // Legacy rows needed a one-time alias backfill when canonical identities were introduced.
  // New collection rows are canonicalized before sh_spotify_tracks is written, so once at
  // least one alias exists the expensive anti-join must not run on every Queue batch.
  const existingAlias = await db.prepare(`SELECT source_track_id
    FROM sh_spotify_track_aliases LIMIT 1`).first();
  if (existingAlias?.source_track_id) {
    aliasBootstrapVerified = true;
    return 0;
  }

  const result = await db.prepare(`SELECT
      track.track_id,track.name,track.duration_ms,track.artists_json
    FROM sh_spotify_tracks track
    LEFT JOIN sh_spotify_track_aliases alias ON alias.source_track_id=track.track_id
    WHERE alias.source_track_id IS NULL
    ORDER BY track.track_id`).all();
  const tracks = rowsOf(result);
  if (!tracks.length) {
    aliasBootstrapVerified = true;
    return 0;
  }
  await resolveCanonicalSpotifyTracks(db, tracks, seenAt);
  aliasBootstrapVerified = true;
  return tracks.length;
}
