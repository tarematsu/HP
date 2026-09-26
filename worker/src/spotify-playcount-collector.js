export const SPOTIFY_TARGET_ARTISTS = Object.freeze([
  Object.freeze({
    artist_key: 'nogizaka46',
    artist_name: '乃木坂46',
    spotify_artist_id: '08lN7bm4Etec8ETFxaTUmq',
  }),
  Object.freeze({
    artist_key: 'sakurazaka46',
    artist_name: '櫻坂46',
    spotify_artist_id: '0Ti7MfCiVVQAK8zLSiqlto',
  }),
  Object.freeze({
    artist_key: 'hinatazaka46',
    artist_name: '日向坂46',
    spotify_artist_id: '0eQSoTI7sQENREQM8Klp2j',
  }),
]);

const SPOTIFY_PUBLIC_ARTIST_BASE = 'https://open.spotify.com/artist/';
const SPOTIFY_PUBLIC_ALBUM_BASE = 'https://open.spotify.com/album/';
const PUBLIC_PAGE_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/145.0.0.0 Safari/537.36';
const D1_BATCH_SIZE = 75;
const QUEUE_BATCH_SIZE = 100;

function enabled(value, fallback = true) {
  if (value == null || value === '') return fallback;
  return !['0', 'false', 'no', 'off'].includes(String(value).trim().toLowerCase());
}

function integer(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function safeText(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function truncateError(error, maxLength = 1000) {
  const text = error instanceof Error ? error.message : String(error ?? 'unknown error');
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function resultsOf(result) {
  return Array.isArray(result?.results) ? result.results : [];
}

export function jstDateKey(timestamp = Date.now()) {
  const value = Number(timestamp);
  if (!Number.isFinite(value)) throw new TypeError('timestamp must be finite');
  return new Date(value + (9 * 60 * 60 * 1000)).toISOString().slice(0, 10);
}

async function responseText(response, label) {
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`${label} failed: HTTP ${response.status}${detail ? ` ${detail.slice(0, 240)}` : ''}`);
  }
  return response.text();
}

function decodeBase64Utf8(value) {
  const binary = atob(String(value || '').trim());
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function decodeSpotifyInitialState(html) {
  const match = String(html || '').match(
    /<script\b[^>]*\bid=["']initialState["'][^>]*>([^<]+)<\/script>/i,
  );
  if (!match) throw new Error('Spotify initialState was not found in page');
  try {
    return JSON.parse(decodeBase64Utf8(match[1]));
  } catch (error) {
    throw new Error(`Spotify initialState decode failed: ${truncateError(error, 300)}`);
  }
}

function addAlbumIdsFromText(value, output) {
  const text = String(value || '');
  for (const pattern of [
    /spotify:album:([A-Za-z0-9]{16,32})/g,
    /(?:\/|\\\/)album(?:\/|\\\/)([A-Za-z0-9]{16,32})/g,
  ]) {
    for (const match of text.matchAll(pattern)) output.add(match[1]);
  }
}

function addAlbumIdsFromValue(value, output) {
  if (value == null) return;
  if (typeof value === 'string') {
    addAlbumIdsFromText(value, output);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) addAlbumIdsFromValue(item, output);
    return;
  }
  if (typeof value === 'object') {
    for (const item of Object.values(value)) addAlbumIdsFromValue(item, output);
  }
}

export function albumIdsFromDiscographyHtml(html) {
  const ids = new Set();
  addAlbumIdsFromText(html, ids);
  try {
    addAlbumIdsFromValue(decodeSpotifyInitialState(html), ids);
  } catch {
    // Some Spotify responses expose release links in rendered HTML without initialState.
  }
  return [...ids];
}

function publicArtistDiscographyUrl(artistId, env) {
  const base = safeText(env?.SPOTIFY_PUBLIC_ARTIST_BASE, SPOTIFY_PUBLIC_ARTIST_BASE);
  return `${base}${encodeURIComponent(artistId)}/discography/all`;
}

async function discoverArtistReleases(artist, env, fetchImpl = fetch) {
  const response = await fetchImpl(publicArtistDiscographyUrl(artist.spotify_artist_id, env), {
    headers: {
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'ja-JP,ja;q=0.9,en;q=0.7',
      'user-agent': PUBLIC_PAGE_USER_AGENT,
    },
  });
  const html = await responseText(response, `Spotify discography for ${artist.artist_key}`);
  const albumIds = albumIdsFromDiscographyHtml(html);
  if (!albumIds.length) {
    throw new Error(`Spotify discography returned no releases for ${artist.artist_key}`);
  }
  return albumIds.map((albumId) => ({ album_id: albumId }));
}

async function batchStatements(db, statements, size = D1_BATCH_SIZE) {
  if (!statements.length) return;
  for (let offset = 0; offset < statements.length; offset += size) {
    await db.batch(statements.slice(offset, offset + size));
  }
}

async function refreshArtistCatalog(db, artist, releases, seenAt) {
  const writes = [];
  for (const release of releases) {
    writes.push(
      db.prepare(`INSERT INTO sh_spotify_releases (
        album_id,name,album_type,release_date,release_date_precision,total_tracks,last_seen_at
      ) VALUES (?,'','','','',NULL,?)
      ON CONFLICT(album_id) DO UPDATE SET
        last_seen_at=excluded.last_seen_at`)
        .bind(release.album_id, seenAt),
      db.prepare(`INSERT INTO sh_spotify_release_targets (
        album_id,artist_key,is_active,last_seen_at
      ) VALUES (?,?,1,?)
      ON CONFLICT(album_id,artist_key) DO UPDATE SET
        is_active=1,
        last_seen_at=excluded.last_seen_at`)
        .bind(release.album_id, artist.artist_key, seenAt),
    );
  }
  await batchStatements(db, writes);
  await db.prepare(`UPDATE sh_spotify_release_targets
    SET is_active=0
    WHERE artist_key=? AND last_seen_at < ?`)
    .bind(artist.artist_key, seenAt)
    .run();
}

async function refreshCatalog(env, dependencies = {}) {
  const db = env?.OTHER_DB;
  if (!db?.prepare || !db?.batch) throw new Error('OTHER_DB binding is required');
  const fetchImpl = dependencies.fetch || fetch;
  const seenAt = Date.now();
  let releasesSeen = 0;
  for (const artist of SPOTIFY_TARGET_ARTISTS) {
    const releases = await discoverArtistReleases(artist, env, fetchImpl);
    await refreshArtistCatalog(db, artist, releases, seenAt);
    releasesSeen += releases.length;
  }
  return { releasesSeen };
}

function queueMessage(snapshotDate, row) {
  const targetByKey = new Map(SPOTIFY_TARGET_ARTISTS.map((artist) => [artist.artist_key, artist]));
  const targetKeys = String(row?.target_keys || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const targets = targetKeys
    .map((key) => targetByKey.get(key))
    .filter(Boolean)
    .map(({ artist_key, spotify_artist_id }) => ({ artist_key, spotify_artist_id }));
  if (!targets.length) return null;
  return {
    message_type: 'spotify-playcount-album',
    message_version: 1,
    snapshot_date: snapshotDate,
    album_id: String(row.album_id),
    targets,
  };
}

async function sendQueueBatch(queue, bodies) {
  for (let offset = 0; offset < bodies.length; offset += QUEUE_BATCH_SIZE) {
    const chunk = bodies.slice(offset, offset + QUEUE_BATCH_SIZE);
    if (typeof queue.sendBatch === 'function') {
      await queue.sendBatch(chunk.map((body) => ({ body, contentType: 'json' })));
      continue;
    }
    for (const body of chunk) await queue.send(body, { contentType: 'json' });
  }
}

async function queueActiveReleases(env, snapshotDate) {
  const db = env?.OTHER_DB;
  const queue = env?.SPOTIFY_PLAYCOUNT_QUEUE;
  if (!queue?.send && !queue?.sendBatch) throw new Error('SPOTIFY_PLAYCOUNT_QUEUE binding is required');
  const query = await db.prepare(`SELECT
      r.album_id,
      GROUP_CONCAT(t.artist_key, ',') AS target_keys
    FROM sh_spotify_releases r
    INNER JOIN sh_spotify_release_targets t ON t.album_id=r.album_id
    WHERE t.is_active=1
    GROUP BY r.album_id
    ORDER BY r.album_id`).all();
  const bodies = resultsOf(query).map((row) => queueMessage(snapshotDate, row)).filter(Boolean);
  if (!bodies.length) throw new Error('Spotify catalog contains no active releases to collect');
  await db.prepare(`UPDATE sh_spotify_collection_runs
    SET albums_queued=?,status='queued',updated_at=?
    WHERE snapshot_date=?`)
    .bind(bodies.length, Date.now(), snapshotDate)
    .run();
  await sendQueueBatch(queue, bodies);
  return bodies.length;
}

async function startRun(db, snapshotDate, startedAt) {
  await db.prepare(`INSERT INTO sh_spotify_collection_runs (
      snapshot_date,status,albums_queued,albums_completed,tracks_collected,errors,
      started_at,completed_at,updated_at,last_error
    ) VALUES (?,'catalog',0,0,0,0,?,NULL,?,NULL)
    ON CONFLICT(snapshot_date) DO UPDATE SET
      status='catalog',
      albums_queued=0,
      albums_completed=0,
      tracks_collected=0,
      errors=0,
      started_at=excluded.started_at,
      completed_at=NULL,
      updated_at=excluded.updated_at,
      last_error=NULL`)
    .bind(snapshotDate, startedAt, startedAt)
    .run();
}

async function failRun(db, snapshotDate, error) {
  const now = Date.now();
  await db.prepare(`UPDATE sh_spotify_collection_runs
    SET status='error',errors=errors+1,updated_at=?,last_error=?
    WHERE snapshot_date=?`)
    .bind(now, truncateError(error), snapshotDate)
    .run();
}

export async function runSpotifyPlaycountScheduled(controller, env, dependencies = {}) {
  if (!enabled(env?.SPOTIFY_PLAYCOUNT_ENABLED, true)) {
    return { skipped: true, reason: 'disabled' };
  }
  const db = env?.OTHER_DB;
  if (!db?.prepare || !db?.batch) throw new Error('OTHER_DB binding is required');
  const scheduledTime = Number(controller?.scheduledTime);
  const snapshotDate = jstDateKey(Number.isFinite(scheduledTime) ? scheduledTime : Date.now());
  const startedAt = Date.now();
  await startRun(db, snapshotDate, startedAt);
  try {
    const catalog = await refreshCatalog(env, dependencies);
    const albumsQueued = await queueActiveReleases(env, snapshotDate);
    return {
      ok: true,
      snapshot_date: snapshotDate,
      releases_seen: catalog.releasesSeen,
      albums_queued: albumsQueued,
    };
  } catch (error) {
    await failRun(db, snapshotDate, error).catch(() => {});
    throw error;
  }
}

function artistIds(rawArtists) {
  const values = [];
  for (const entry of rawArtists || []) {
    const artist = entry?.artist || entry;
    const id = safeText(artist?.id);
    const uri = safeText(artist?.uri);
    const parsed = id || (uri.startsWith('spotify:artist:') ? uri.slice('spotify:artist:'.length) : '');
    if (parsed) values.push({
      id: parsed,
      name: safeText(artist?.profile?.name || artist?.name),
    });
  }
  return values;
}

function trackId(rawTrack) {
  const id = safeText(rawTrack?.id);
  if (id) return id;
  const uri = safeText(rawTrack?.uri);
  return uri.startsWith('spotify:track:') ? uri.slice('spotify:track:'.length) : '';
}

export function albumFromInitialState(state, albumId) {
  const key = `spotify:album:${safeText(albumId)}`;
  const album = state?.entities?.items?.[key];
  if (!album || typeof album !== 'object') {
    throw new Error(`Spotify album ${albumId} was not found in initialState`);
  }
  return album;
}

export function normalizeAlbumTracks(payload, targets) {
  const targetBySpotifyId = new Map(
    (targets || []).map((target) => [safeText(target?.spotify_artist_id), target]).filter(([id]) => id),
  );
  const album = payload?.data?.albumUnion || payload?.data?.album || payload;
  const albumArtists = artistIds(album?.artists?.items || album?.artists);
  const items = Array.isArray(album?.tracks?.items) ? album.tracks.items : [];
  const normalized = [];
  for (const item of items) {
    const rawTrack = item?.track || item;
    const id = trackId(rawTrack);
    const playcount = integer(rawTrack?.playcount);
    if (!id || playcount == null || playcount < 0) continue;
    let artists = artistIds(rawTrack?.artists?.items || rawTrack?.artists);
    if (!artists.length) artists = albumArtists;
    const matchedTargets = artists
      .map(({ id: artistId }) => targetBySpotifyId.get(artistId))
      .filter(Boolean);
    if (!matchedTargets.length) continue;
    normalized.push({
      track_id: id,
      name: safeText(rawTrack?.name),
      playcount,
      disc_number: integer(rawTrack?.discNumber ?? rawTrack?.disc_number),
      track_number: integer(rawTrack?.trackNumber ?? rawTrack?.track_number),
      duration_ms: integer(
        rawTrack?.duration?.totalMilliseconds
        ?? rawTrack?.duration_ms
        ?? rawTrack?.durationMs,
      ),
      artists_json: JSON.stringify(artists),
      target_keys: [...new Set(matchedTargets.map((target) => target.artist_key))],
    });
  }
  return normalized;
}

function albumCreditsAnyTarget(album, targets) {
  const targetIds = new Set((targets || []).map((target) => safeText(target?.spotify_artist_id)).filter(Boolean));
  const artists = artistIds(album?.artists?.items || album?.artists);
  return artists.some(({ id }) => targetIds.has(id));
}

async function albumPlaycountPayload(albumId, env, fetchImpl = fetch) {
  const base = safeText(env?.SPOTIFY_PUBLIC_ALBUM_BASE, SPOTIFY_PUBLIC_ALBUM_BASE);
  const response = await fetchImpl(`${base}${encodeURIComponent(albumId)}`, {
    headers: {
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'ja-JP,ja;q=0.9,en;q=0.7',
      'user-agent': PUBLIC_PAGE_USER_AGENT,
    },
  });
  const html = await responseText(response, `Spotify album page ${albumId}`);
  return albumFromInitialState(decodeSpotifyInitialState(html), albumId);
}

async function previousPlaycounts(db, trackIds) {
  if (!trackIds.length) return new Map();
  const placeholders = trackIds.map(() => '?').join(',');
  const result = await db.prepare(
    `SELECT track_id,playcount FROM sh_spotify_playcount_current WHERE track_id IN (${placeholders})`,
  ).bind(...trackIds).all();
  return new Map(resultsOf(result).map((row) => [String(row.track_id), integer(row.playcount)]));
}

async function persistAlbumMetadata(db, message, album, collectedAt) {
  const name = safeText(album?.name);
  const totalTracks = integer(album?.tracks?.totalCount);
  await db.prepare(`UPDATE sh_spotify_releases SET
      name=CASE WHEN ?!='' THEN ? ELSE name END,
      total_tracks=COALESCE(?,total_tracks),
      last_seen_at=MAX(last_seen_at,?)
    WHERE album_id=?`)
    .bind(name, name, totalTracks, collectedAt, message.album_id)
    .run();
}

async function persistAlbumTracks(db, message, tracks, collectedAt) {
  const previous = await previousPlaycounts(db, tracks.map((track) => track.track_id));
  const writes = [];
  for (const track of tracks) {
    writes.push(
      db.prepare(`INSERT INTO sh_spotify_tracks (
          track_id,album_id,name,disc_number,track_number,duration_ms,artists_json,updated_at
        ) VALUES (?,?,?,?,?,?,?,?)
        ON CONFLICT(track_id) DO UPDATE SET
          name=excluded.name,
          disc_number=COALESCE(excluded.disc_number,sh_spotify_tracks.disc_number),
          track_number=COALESCE(excluded.track_number,sh_spotify_tracks.track_number),
          duration_ms=COALESCE(excluded.duration_ms,sh_spotify_tracks.duration_ms),
          artists_json=CASE WHEN excluded.artists_json!='[]' THEN excluded.artists_json ELSE sh_spotify_tracks.artists_json END,
          updated_at=excluded.updated_at`)
        .bind(
          track.track_id,
          message.album_id,
          track.name,
          track.disc_number,
          track.track_number,
          track.duration_ms,
          track.artists_json,
          collectedAt,
        ),
    );
    for (const artistKey of track.target_keys) {
      writes.push(
        db.prepare(`INSERT INTO sh_spotify_track_targets (track_id,artist_key)
          VALUES (?,?)
          ON CONFLICT(track_id,artist_key) DO NOTHING`)
          .bind(track.track_id, artistKey),
      );
    }
    const previousValue = previous.get(track.track_id);
    const delta = previousValue == null || track.playcount < previousValue
      ? null
      : track.playcount - previousValue;
    writes.push(
      db.prepare(`INSERT INTO sh_spotify_playcount_daily (
          snapshot_date,track_id,playcount,delta,collected_at
        ) VALUES (?,?,?,?,?)
        ON CONFLICT(snapshot_date,track_id) DO NOTHING`)
        .bind(message.snapshot_date, track.track_id, track.playcount, delta, collectedAt),
      db.prepare(`INSERT INTO sh_spotify_playcount_current (
          track_id,playcount,snapshot_date,collected_at
        ) VALUES (?,?,?,?)
        ON CONFLICT(track_id) DO UPDATE SET
          playcount=CASE
            WHEN excluded.collected_at >= sh_spotify_playcount_current.collected_at
            THEN excluded.playcount ELSE sh_spotify_playcount_current.playcount END,
          snapshot_date=CASE
            WHEN excluded.collected_at >= sh_spotify_playcount_current.collected_at
            THEN excluded.snapshot_date ELSE sh_spotify_playcount_current.snapshot_date END,
          collected_at=MAX(sh_spotify_playcount_current.collected_at,excluded.collected_at)`)
        .bind(track.track_id, track.playcount, message.snapshot_date, collectedAt),
    );
  }
  await batchStatements(db, writes);
}

async function collectAlbum(env, message, dependencies = {}) {
  const db = env?.OTHER_DB;
  const fetchImpl = dependencies.fetch || fetch;
  const album = await albumPlaycountPayload(message.album_id, env, fetchImpl);
  const tracks = normalizeAlbumTracks(album, message.targets);
  if (!tracks.length) {
    if (!albumCreditsAnyTarget(album, message.targets)) {
      return { trackCount: 0, unrelated: true };
    }
    throw new Error(`Spotify album ${message.album_id} returned no target playcount tracks`);
  }
  const collectedAt = Date.now();
  await persistAlbumMetadata(db, message, album, collectedAt);
  await persistAlbumTracks(db, message, tracks, collectedAt);
  return { trackCount: tracks.length, unrelated: false };
}

async function deactivateUnrelatedRelease(db, message) {
  const targetKeys = (message.targets || []).map((target) => safeText(target?.artist_key)).filter(Boolean);
  if (!targetKeys.length) return;
  const placeholders = targetKeys.map(() => '?').join(',');
  await db.prepare(`UPDATE sh_spotify_release_targets
    SET is_active=0
    WHERE album_id=? AND artist_key IN (${placeholders})`)
    .bind(message.album_id, ...targetKeys)
    .run();
}

async function completeAlbum(db, message, trackCount) {
  const now = Date.now();
  await db.prepare(`INSERT INTO sh_spotify_collection_album_runs (
      snapshot_date,album_id,status,track_count,attempts,last_error,updated_at
    ) VALUES (?,?,'complete',?,1,NULL,?)
    ON CONFLICT(snapshot_date,album_id) DO UPDATE SET
      status='complete',
      track_count=excluded.track_count,
      attempts=sh_spotify_collection_album_runs.attempts+1,
      last_error=NULL,
      updated_at=excluded.updated_at`)
    .bind(message.snapshot_date, message.album_id, trackCount, now)
    .run();

  await db.prepare(`UPDATE sh_spotify_collection_runs
    SET
      albums_completed=(
        SELECT COUNT(*) FROM sh_spotify_collection_album_runs
        WHERE snapshot_date=? AND status='complete'
      ),
      tracks_collected=COALESCE((
        SELECT SUM(track_count) FROM sh_spotify_collection_album_runs
        WHERE snapshot_date=? AND status='complete'
      ),0),
      errors=(
        SELECT COUNT(*) FROM sh_spotify_collection_album_runs
        WHERE snapshot_date=? AND status='error'
      ),
      status=CASE
        WHEN (
          SELECT COUNT(*) FROM sh_spotify_collection_album_runs
          WHERE snapshot_date=? AND status='complete'
        ) >= albums_queued THEN 'complete'
        ELSE 'queued'
      END,
      completed_at=CASE
        WHEN (
          SELECT COUNT(*) FROM sh_spotify_collection_album_runs
          WHERE snapshot_date=? AND status='complete'
        ) >= albums_queued THEN ?
        ELSE completed_at
      END,
      updated_at=?
    WHERE snapshot_date=?`)
    .bind(
      message.snapshot_date,
      message.snapshot_date,
      message.snapshot_date,
      message.snapshot_date,
      message.snapshot_date,
      now,
      now,
      message.snapshot_date,
    )
    .run();
}

async function recordAlbumError(db, message, error) {
  const now = Date.now();
  const detail = truncateError(error);
  await db.prepare(`INSERT INTO sh_spotify_collection_album_runs (
      snapshot_date,album_id,status,track_count,attempts,last_error,updated_at
    ) VALUES (?,?,'error',0,1,?,?)
    ON CONFLICT(snapshot_date,album_id) DO UPDATE SET
      status=CASE
        WHEN sh_spotify_collection_album_runs.status='complete'
        THEN 'complete' ELSE 'error' END,
      attempts=sh_spotify_collection_album_runs.attempts+1,
      last_error=CASE
        WHEN sh_spotify_collection_album_runs.status='complete'
        THEN NULL ELSE excluded.last_error END,
      updated_at=excluded.updated_at`)
    .bind(message.snapshot_date, message.album_id, detail, now)
    .run();
  await db.prepare(`UPDATE sh_spotify_collection_runs
    SET
      errors=(
        SELECT COUNT(*) FROM sh_spotify_collection_album_runs
        WHERE snapshot_date=? AND status='error'
      ),
      updated_at=?,
      last_error=?
    WHERE snapshot_date=?`)
    .bind(message.snapshot_date, now, detail, message.snapshot_date)
    .run();
}

function validAlbumMessage(body) {
  if (body?.message_type !== 'spotify-playcount-album' || Number(body?.message_version) !== 1) {
    return false;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body?.snapshot_date || ''))) return false;
  if (!safeText(body?.album_id)) return false;
  return Array.isArray(body?.targets) && body.targets.some(
    (target) => safeText(target?.artist_key) && safeText(target?.spotify_artist_id),
  );
}

export async function processSpotifyPlaycountBatch(batch, env, dependencies = {}) {
  if (!enabled(env?.SPOTIFY_PLAYCOUNT_ENABLED, true)) {
    for (const message of batch?.messages || []) message.ack?.();
    return { skipped: true, reason: 'disabled' };
  }
  const db = env?.OTHER_DB;
  if (!db?.prepare || !db?.batch) throw new Error('OTHER_DB binding is required');
  const messages = batch?.messages || [];
  if (!messages.length) return { processed: 0, failed: 0 };
  let processed = 0;
  let failed = 0;

  for (const queueMessageEntry of messages) {
    const message = queueMessageEntry?.body;
    if (!validAlbumMessage(message)) {
      queueMessageEntry.ack?.();
      continue;
    }
    try {
      const result = await collectAlbum(env, message, dependencies);
      if (result.unrelated) await deactivateUnrelatedRelease(db, message);
      await completeAlbum(db, message, result.trackCount);
      queueMessageEntry.ack?.();
      processed += 1;
    } catch (error) {
      failed += 1;
      await recordAlbumError(db, message, error).catch(() => {});
      if (typeof queueMessageEntry.retry === 'function') {
        queueMessageEntry.retry();
      } else {
        throw error;
      }
    }
  }
  return { processed, failed };
}
