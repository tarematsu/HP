// Each collection attempt is an immutable, independently recoverable R2
// observation. Keeping all retries (rather than last-write-wins album objects)
// preserves the old D1 candidate MAX(playcount) semantics across races.
const PREFIX = 'spotify-playcount-candidates/v1/';
const VERSION = 1;
const MAX_LIST_PAGES = 20;
const MAX_OBJECTS = 10_000;
const MAX_PARALLEL_READS = 8;

function required(value, name) {
  const text = String(value || '').trim();
  if (!text || text.length > 160) throw new Error(`invalid Spotify R2 candidate ${name}`);
  return text;
}

export function spotifyR2CandidateRunPrefix(message) {
  const day = required(message?.snapshot_date, 'date');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('invalid Spotify R2 candidate date');
  const run = required(message?.run_token, 'run token');
  return `${PREFIX}${day}/${encodeURIComponent(run)}/`;
}

export function spotifyR2CandidatesEnabled(env) {
  const flag = String(env?.SPOTIFY_R2_CANDIDATES_ENABLED ?? '').trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(flag);
}

function bucket(env) {
  const r2 = env?.PAGES_RESPONSE_R2;
  if (typeof r2?.put !== 'function' || typeof r2?.get !== 'function'
      || typeof r2?.list !== 'function') {
    throw new Error('Spotify candidate R2 read/write/list binding is required');
  }
  return r2;
}

export async function saveSpotifyR2AlbumCandidates(env, message, tracks, collectedAt) {
  const r2 = bucket(env);
  const albumId = required(message.album_id, 'album ID');
  if (!Array.isArray(tracks) || !tracks.length) throw new Error('Spotify R2 album candidates are empty');
  // Never overwrite an earlier successful observation when a queue retry
  // races the same album; finalization combines every accepted observation.
  const nonce = crypto.randomUUID();
  const key = `${spotifyR2CandidateRunPrefix(message)}${encodeURIComponent(albumId)}/${nonce}.json`;
  const values = tracks.map(row => [
    required(row.track_id, 'track ID'), Number(row.playcount), Number(collectedAt),
  ]);
  if (values.some(([, playcount, timestamp]) => !Number.isSafeInteger(playcount)
      || playcount < 0 || !Number.isSafeInteger(timestamp))) {
    throw new Error('invalid Spotify candidate values');
  }
  await r2.put(key, JSON.stringify({
    version: VERSION,
    snapshot_date: message.snapshot_date,
    run_token: message.run_token,
    album_id: albumId,
    rows: values,
  }), { httpMetadata: { contentType: 'application/json; charset=utf-8' } });
  return { key, count: values.length };
}

async function listKeys(r2, prefix) {
  const keys = [];
  let cursor;
  for (let page = 0; page < MAX_LIST_PAGES; page++) {
    const result = await r2.list(cursor ? { prefix, cursor } : { prefix });
    for (const object of result?.objects || []) {
      if (typeof object.key !== 'string' || !object.key.startsWith(prefix)) continue;
      keys.push(object.key);
    }
    if (keys.length > MAX_OBJECTS) throw new Error('Spotify R2 candidate run exceeds object limit');
    if (result?.truncated !== true) return keys;
    if (!result.cursor || result.cursor === cursor) throw new Error('Spotify R2 candidate list cursor stalled');
    cursor = result.cursor;
  }
  throw new Error('Spotify R2 candidate run pagination exceeded safety limit');
}

function candidateRows(payload, key, message, allowedAlbums) {
  if (Number(payload?.version) !== VERSION
      || payload.snapshot_date !== message.snapshot_date
      || payload.run_token !== message.run_token
      || !allowedAlbums.has(payload.album_id)
      || !Array.isArray(payload.rows) || !payload.rows.length) {
    throw new Error(`Spotify R2 candidate is invalid: ${key}`);
  }
  return payload.rows.map(row => {
    if (!Array.isArray(row) || row.length !== 3) throw new Error('invalid Spotify R2 candidate row');
    const [trackId, playcount, collectedAt] = row;
    if (typeof trackId !== 'string' || !trackId || !Number.isSafeInteger(playcount)
        || playcount < 0 || !Number.isSafeInteger(collectedAt)) {
      throw new Error('invalid Spotify R2 candidate row values');
    }
    return { track_id: trackId, playcount, collected_at: collectedAt };
  });
}

export async function loadSpotifyR2RunCandidates(env, message, completeAlbums) {
  const r2 = bucket(env);
  const counts = new Map((completeAlbums || []).filter(row => Number(row.track_count) > 0)
    .map(row => [String(row.album_id), Number(row.track_count)]));
  const allowed = new Set(counts.keys());
  if (!allowed.size) throw new Error('Spotify R2 candidate run has no completed albums');
  const prefix = spotifyR2CandidateRunPrefix(message);
  const keys = await listKeys(r2, prefix);
  const seenAlbums = new Set();
  const matchedCounts = new Set();
  const values = new Map();
  // Bounded R2 concurrency; the Queue invocation has 30 seconds CPU budget.
  let nextIndex = 0;
  const read = async () => {
    for (;;) {
      const index = nextIndex++;
      if (index >= keys.length) return;
      const key = keys[index];
      const object = await r2.get(key);
      if (!object) throw new Error(`Spotify candidate R2 object disappeared: ${key}`);
      const payload = typeof object.json === 'function'
        ? await object.json() : JSON.parse(await object.text());
      // Ignore observations uploaded by albums that never committed success.
      if (!allowed.has(payload?.album_id)) continue;
      const albumPrefix = `${prefix}${encodeURIComponent(payload.album_id)}/`;
      if (!key.startsWith(albumPrefix)) throw new Error('Spotify R2 candidate album/key mismatch');
      const rows = candidateRows(payload, key, message, allowed);
      seenAlbums.add(payload.album_id);
      // D1's committed album count is a completion receipt, not merely
      // presence. An intact immutable object must match that observation's
      // track count before the run can be published.
      if (rows.length === counts.get(payload.album_id)) matchedCounts.add(payload.album_id);
      for (const row of rows) {
        const old = values.get(row.track_id);
        if (!old || row.playcount > old.playcount
          || (row.playcount === old.playcount && row.collected_at > old.collected_at)) {
          values.set(row.track_id, row);
        }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(MAX_PARALLEL_READS, keys.length) }, () => read()));
  for (const albumId of allowed) {
    if (!seenAlbums.has(albumId)) throw new Error(`Spotify R2 candidate album missing: ${albumId}`);
    if (!matchedCounts.has(albumId)) throw new Error(`Spotify R2 candidate album count mismatch: ${albumId}`);
  }
  return [...values.values()].sort((a, b) => a.track_id.localeCompare(b.track_id));
}

export async function cleanupSpotifyR2RunCandidates(env, message) {
  const r2 = bucket(env);
  const keys = await listKeys(r2, spotifyR2CandidateRunPrefix(message));
  for (let i = 0; i < keys.length; i += 100) {
    await r2.delete(keys.slice(i, i + 100));
  }
  return keys.length;
}
