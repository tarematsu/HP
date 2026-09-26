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
const FIRST_CHECK_HOUR_JST = 5;
const STUCK_ATTEMPT_MS = 50 * 60 * 1000;
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

export function jstHour(timestamp = Date.now()) {
  const value = Number(timestamp);
  if (!Number.isFinite(value)) throw new TypeError('timestamp must be finite');
  return new Date(value + (9 * 60 * 60 * 1000)).getUTCHours();
}

function previousDateKey(snapshotDate) {
  const date = new Date(`${snapshotDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) throw new TypeError('snapshotDate must be YYYY-MM-DD');
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
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
    // Some responses expose release links in rendered HTML without initialState.
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
  return albumIds;
}

async function batchStatements(db, statements, size = D1_BATCH_SIZE) {
  if (!statements.length) return;
  for (let offset = 0; offset < statements.length; offset += size) {
    await db.batch(statements.slice(offset, offset + size));
  }
}

async function refreshArtistCatalog(db, artist, albumIds, seenAt) {
  const writes = [];
  for (const albumId of albumIds) {
    writes.push(
      db.prepare(`INSERT INTO sh_spotify_releases (
        album_id,name,album_type,release_date,release_date_precision,total_tracks,last_seen_at
      ) VALUES (?,'','','','',NULL,?)
      ON CONFLICT(album_id) DO UPDATE SET
        last_seen_at=MAX(sh_spotify_releases.last_seen_at,excluded.last_seen_at)`)
        .bind(albumId, seenAt),
      db.prepare(`INSERT INTO sh_spotify_release_targets (
        album_id,artist_key,is_active,last_seen_at
      ) VALUES (?,?,1,?)
      ON CONFLICT(album_id,artist_key) DO UPDATE SET
        is_active=1,
        last_seen_at=MAX(sh_spotify_release_targets.last_seen_at,excluded.last_seen_at)`)
        .bind(albumId, artist.artist_key, seenAt),
    );
  }
  await batchStatements(db, writes);
}

async function refreshCatalog(env, dependencies = {}) {
  const db = env?.OTHER_DB;
  if (!db?.prepare || !db?.batch) throw new Error('OTHER_DB binding is required');
  const fetchImpl = dependencies.fetch || fetch;
  const seenAt = Date.now();
  let releasesSeen = 0;
  for (const artist of SPOTIFY_TARGET_ARTISTS) {
    const albumIds = await discoverArtistReleases(artist, env, fetchImpl);
    await refreshArtistCatalog(db, artist, albumIds, seenAt);
    releasesSeen += albumIds.length;
  }
  return { releasesSeen };
}

function queueMessage(snapshotDate, runToken, row) {
  const targetByKey = new Map(SPOTIFY_TARGET_ARTISTS.map((artist) => [artist.artist_key, artist]));
  const targets = String(row?.target_keys || '')
    .split(',')
    .map((value) => targetByKey.get(value.trim()))
    .filter(Boolean)
    .map(({ artist_key, spotify_artist_id }) => ({ artist_key, spotify_artist_id }));
  if (!targets.length) return null;
  return {
    message_type: 'spotify-playcount-album',
    message_version: 2,
    snapshot_date: snapshotDate,
    run_token: runToken,
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

async function queueActiveReleases(env, snapshotDate, runToken) {
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
  const bodies = resultsOf(query)
    .map((row) => queueMessage(snapshotDate, runToken, row))
    .filter(Boolean);
  if (!bodies.length) throw new Error('Spotify catalog contains no active releases to collect');
  await db.prepare(`UPDATE sh_spotify_collection_runs
    SET albums_queued=?,status='queued',updated_at=?
    WHERE snapshot_date=? AND run_token=?`)
    .bind(bodies.length, Date.now(), snapshotDate, runToken)
    .run();
  await sendQueueBatch(queue, bodies);
  return bodies.length;
}

async function readRun(db, snapshotDate) {
  return db.prepare(`SELECT
      snapshot_date,status,attempt_no,run_token,albums_queued,albums_completed,
      tracks_collected,errors,started_at,attempt_started_at,completed_at,updated_at,last_error
    FROM sh_spotify_collection_runs
    WHERE snapshot_date=?`)
    .bind(snapshotDate)
    .first();
}

async function oldestIncompleteRun(db, today) {
  return db.prepare(`SELECT snapshot_date,status,updated_at
    FROM sh_spotify_collection_runs
    WHERE snapshot_date < ? AND status != 'complete'
    ORDER BY snapshot_date
    LIMIT 1`)
    .bind(today)
    .first();
}

export function shouldRetryRun(run, now = Date.now()) {
  if (!run) return true;
  if (run.status === 'complete') return false;
  if (!['catalog', 'queued'].includes(String(run.status))) return true;
  const updatedAt = Number(run.updated_at);
  return !Number.isFinite(updatedAt) || now - updatedAt >= STUCK_ATTEMPT_MS;
}

async function selectScheduledSnapshot(db, scheduledTime) {
  const today = jstDateKey(scheduledTime);
  const todayRun = await readRun(db, today);
  if (todayRun?.status === 'complete') return { skip: 'complete' };

  const older = await oldestIncompleteRun(db, today);
  if (older) {
    if (!shouldRetryRun(older, scheduledTime)) return { skip: 'in-flight' };
    return { snapshotDate: older.snapshot_date };
  }

  if (jstHour(scheduledTime) < FIRST_CHECK_HOUR_JST) {
    if (!todayRun) return { skip: 'before-05:00' };
  }

  if (!shouldRetryRun(todayRun, scheduledTime)) {
    return { skip: 'in-flight' };
  }
  return { snapshotDate: today };
}

async function beginAttempt(db, snapshotDate, attemptNo, runToken, startedAt) {
  await db.prepare(`INSERT INTO sh_spotify_collection_runs (
      snapshot_date,status,attempt_no,run_token,albums_queued,albums_completed,
      tracks_collected,errors,started_at,attempt_started_at,completed_at,updated_at,last_error
    ) VALUES (?,'catalog',?,?,0,0,0,0,?,?,NULL,?,NULL)
    ON CONFLICT(snapshot_date) DO UPDATE SET
      status='catalog',
      attempt_no=excluded.attempt_no,
      run_token=excluded.run_token,
      albums_queued=0,
      albums_completed=0,
      tracks_collected=0,
      errors=0,
      attempt_started_at=excluded.attempt_started_at,
      completed_at=NULL,
      updated_at=excluded.updated_at,
      last_error=NULL`)
    .bind(snapshotDate, attemptNo, runToken, startedAt, startedAt, startedAt)
    .run();

  await db.batch([
    db.prepare(`DELETE FROM sh_spotify_collection_album_runs WHERE snapshot_date=?`).bind(snapshotDate),
    db.prepare(`DELETE FROM sh_spotify_playcount_candidates WHERE snapshot_date=?`).bind(snapshotDate),
  ]);
}

async function failRun(db, snapshotDate, runToken, error) {
  await db.prepare(`UPDATE sh_spotify_collection_runs
    SET status='error',errors=errors+1,updated_at=?,last_error=?
    WHERE snapshot_date=? AND run_token=?`)
    .bind(Date.now(), truncateError(error), snapshotDate, runToken)
    .run();
}

export async function runSpotifyPlaycountScheduled(controller, env, dependencies = {}) {
  if (!enabled(env?.SPOTIFY_PLAYCOUNT_ENABLED, true)) {
    return { skipped: true, reason: 'disabled' };
  }
  const db = env?.OTHER_DB;
  if (!db?.prepare || !db?.batch) throw new Error('OTHER_DB binding is required');

  const rawScheduledTime = Number(controller?.scheduledTime);
  const scheduledTime = Number.isFinite(rawScheduledTime) ? rawScheduledTime : Date.now();
  const selection = await selectScheduledSnapshot(db, scheduledTime);
  if (!selection.snapshotDate) return { skipped: true, reason: selection.skip };

  const snapshotDate = selection.snapshotDate;
  const existing = await readRun(db, snapshotDate);
  const attemptNo = Math.max(0, integer(existing?.attempt_no) ?? 0) + 1;
  const runToken = `${snapshotDate}:${scheduledTime}:${attemptNo}`;
  const startedAt = Date.now();
  await beginAttempt(db, snapshotDate, attemptNo, runToken, startedAt);

  try {
    let catalog = { releasesSeen: 0 };
    if (!existing || Number(existing.albums_queued || 0) === 0) {
      catalog = await refreshCatalog(env, dependencies);
    }
    const albumsQueued = await queueActiveReleases(env, snapshotDate, runToken);
    return {
      ok: true,
      snapshot_date: snapshotDate,
      attempt_no: attemptNo,
      releases_seen: catalog.releasesSeen,
      albums_queued: albumsQueued,
    };
  } catch (error) {
    await failRun(db, snapshotDate, runToken, error).catch(() => {});
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

async function activeRunMatches(db, message) {
  const row = await db.prepare(`SELECT run_token,status
    FROM sh_spotify_collection_runs WHERE snapshot_date=?`)
    .bind(message.snapshot_date)
    .first();
  return row?.run_token === message.run_token && row?.status !== 'complete';
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

async function persistCandidateTracks(db, message, tracks, collectedAt) {
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
      db.prepare(`INSERT INTO sh_spotify_playcount_candidates (
          snapshot_date,run_token,track_id,album_id,playcount,collected_at
        ) VALUES (?,?,?,?,?,?)
        ON CONFLICT(snapshot_date,track_id) DO UPDATE SET
          run_token=excluded.run_token,
          album_id=excluded.album_id,
          playcount=excluded.playcount,
          collected_at=excluded.collected_at`)
        .bind(
          message.snapshot_date,
          message.run_token,
          track.track_id,
          message.album_id,
          track.playcount,
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
      return { trackCount: 0, unrelated: true, stale: false };
    }
    throw new Error(`Spotify album ${message.album_id} returned no target playcount tracks`);
  }
  if (!(await activeRunMatches(db, message))) {
    return { trackCount: 0, unrelated: false, stale: true };
  }
  const collectedAt = Date.now();
  await persistAlbumMetadata(db, message, album, collectedAt);
  await persistCandidateTracks(db, message, tracks, collectedAt);
  return { trackCount: tracks.length, unrelated: false, stale: false };
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

export function hasPlaycountAdvance(previousRows, candidateRows) {
  const previous = new Map(
    (previousRows || []).map((row) => [String(row.track_id), integer(row.playcount)]),
  );
  if (!previous.size) return true;
  for (const row of candidateRows || []) {
    const oldValue = previous.get(String(row.track_id));
    const newValue = integer(row.playcount);
    if (oldValue != null && newValue != null && newValue > oldValue) return true;
  }
  return false;
}

async function finalizeAttempt(db, message) {
  const run = await readRun(db, message.snapshot_date);
  if (!run || run.run_token !== message.run_token || run.status === 'complete') {
    return { staleMessage: true };
  }
  if (Number(run.albums_completed || 0) < Number(run.albums_queued || 0)) {
    return { pending: true };
  }

  const candidateResult = await db.prepare(`SELECT track_id,playcount,collected_at
    FROM sh_spotify_playcount_candidates
    WHERE snapshot_date=? AND run_token=?
    ORDER BY track_id`)
    .bind(message.snapshot_date, message.run_token)
    .all();
  const candidates = resultsOf(candidateResult);
  if (!candidates.length) {
    await failRun(db, message.snapshot_date, message.run_token, new Error('Spotify attempt collected no tracks'));
    return { error: true };
  }

  const previousDate = previousDateKey(message.snapshot_date);
  const previousResult = await db.prepare(`SELECT track_id,playcount
    FROM sh_spotify_playcount_daily
    WHERE snapshot_date=?
    ORDER BY track_id`)
    .bind(previousDate)
    .all();
  const previous = resultsOf(previousResult);

  if (previous.length) {
    const candidateIds = new Set(candidates.map((row) => String(row.track_id)));
    const missing = previous.filter((row) => !candidateIds.has(String(row.track_id)));
    if (missing.length) {
      const detail = `candidate snapshot is missing ${missing.length} tracks from ${previousDate}`;
      const now = Date.now();
      await db.prepare(`UPDATE sh_spotify_collection_runs
        SET status='incomplete',updated_at=?,completed_at=?,last_error=?
        WHERE snapshot_date=? AND run_token=?`)
        .bind(now, now, detail, message.snapshot_date, message.run_token)
        .run();
      return { incomplete: true, missing: missing.length };
    }

    if (!hasPlaycountAdvance(previous, candidates)) {
      const now = Date.now();
      await db.prepare(`UPDATE sh_spotify_collection_runs
        SET status='stale',updated_at=?,completed_at=?,last_error='Spotify playcounts have not advanced from the previous day'
        WHERE snapshot_date=? AND run_token=?`)
        .bind(now, now, message.snapshot_date, message.run_token)
        .run();
      return { stale: true };
    }
  }

  const previousMap = new Map(previous.map((row) => [String(row.track_id), integer(row.playcount)]));
  const writes = [];
  for (const row of candidates) {
    const trackIdValue = String(row.track_id);
    const playcount = integer(row.playcount);
    if (playcount == null || playcount < 0) continue;
    const oldValue = previousMap.get(trackIdValue);
    const delta = oldValue == null || playcount < oldValue ? null : playcount - oldValue;
    writes.push(
      db.prepare(`INSERT INTO sh_spotify_playcount_daily (
          snapshot_date,track_id,playcount,delta,collected_at
        ) VALUES (?,?,?,?,?)
        ON CONFLICT(snapshot_date,track_id) DO UPDATE SET
          playcount=excluded.playcount,
          delta=excluded.delta,
          collected_at=excluded.collected_at`)
        .bind(message.snapshot_date, trackIdValue, playcount, delta, row.collected_at),
      db.prepare(`INSERT INTO sh_spotify_playcount_current (
          track_id,playcount,snapshot_date,collected_at
        ) VALUES (?,?,?,?)
        ON CONFLICT(track_id) DO UPDATE SET
          playcount=excluded.playcount,
          snapshot_date=excluded.snapshot_date,
          collected_at=excluded.collected_at`)
        .bind(trackIdValue, playcount, message.snapshot_date, row.collected_at),
    );
  }
  await batchStatements(db, writes);

  const now = Date.now();
  await db.prepare(`UPDATE sh_spotify_collection_runs
    SET status='complete',tracks_collected=?,errors=0,completed_at=?,updated_at=?,last_error=NULL
    WHERE snapshot_date=? AND run_token=?`)
    .bind(candidates.length, now, now, message.snapshot_date, message.run_token)
    .run();
  return { complete: true, tracks: candidates.length };
}

async function completeAlbum(db, message, trackCount) {
  const now = Date.now();
  await db.prepare(`INSERT INTO sh_spotify_collection_album_runs (
      snapshot_date,run_token,album_id,status,track_count,attempts,last_error,updated_at
    ) VALUES (?,?,?,'complete',?,1,NULL,?)
    ON CONFLICT(snapshot_date,album_id) DO UPDATE SET
      run_token=excluded.run_token,
      status='complete',
      track_count=excluded.track_count,
      attempts=sh_spotify_collection_album_runs.attempts+1,
      last_error=NULL,
      updated_at=excluded.updated_at`)
    .bind(message.snapshot_date, message.run_token, message.album_id, trackCount, now)
    .run();

  await db.prepare(`UPDATE sh_spotify_collection_runs
    SET
      albums_completed=(
        SELECT COUNT(*) FROM sh_spotify_collection_album_runs
        WHERE snapshot_date=? AND run_token=? AND status='complete'
      ),
      errors=(
        SELECT COUNT(*) FROM sh_spotify_collection_album_runs
        WHERE snapshot_date=? AND run_token=? AND status='error'
      ),
      updated_at=?
    WHERE snapshot_date=? AND run_token=?`)
    .bind(
      message.snapshot_date,
      message.run_token,
      message.snapshot_date,
      message.run_token,
      now,
      message.snapshot_date,
      message.run_token,
    )
    .run();

  return finalizeAttempt(db, message);
}

async function recordAlbumError(db, message, error) {
  const now = Date.now();
  const detail = truncateError(error);
  await db.prepare(`INSERT INTO sh_spotify_collection_album_runs (
      snapshot_date,run_token,album_id,status,track_count,attempts,last_error,updated_at
    ) VALUES (?,?,?,'error',0,1,?,?)
    ON CONFLICT(snapshot_date,album_id) DO UPDATE SET
      run_token=excluded.run_token,
      status=CASE
        WHEN sh_spotify_collection_album_runs.run_token=excluded.run_token
          AND sh_spotify_collection_album_runs.status='complete'
        THEN 'complete' ELSE 'error' END,
      attempts=sh_spotify_collection_album_runs.attempts+1,
      last_error=CASE
        WHEN sh_spotify_collection_album_runs.run_token=excluded.run_token
          AND sh_spotify_collection_album_runs.status='complete'
        THEN NULL ELSE excluded.last_error END,
      updated_at=excluded.updated_at`)
    .bind(message.snapshot_date, message.run_token, message.album_id, detail, now)
    .run();
  await db.prepare(`UPDATE sh_spotify_collection_runs
    SET
      errors=(
        SELECT COUNT(*) FROM sh_spotify_collection_album_runs
        WHERE snapshot_date=? AND run_token=? AND status='error'
      ),
      updated_at=?,
      last_error=?
    WHERE snapshot_date=? AND run_token=?`)
    .bind(
      message.snapshot_date,
      message.run_token,
      now,
      detail,
      message.snapshot_date,
      message.run_token,
    )
    .run();
}

function validAlbumMessage(body) {
  if (body?.message_type !== 'spotify-playcount-album' || Number(body?.message_version) !== 2) {
    return false;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body?.snapshot_date || ''))) return false;
  if (!safeText(body?.run_token) || !safeText(body?.album_id)) return false;
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
  if (!messages.length) return { processed: 0, failed: 0, ignored: 0 };
  let processed = 0;
  let failed = 0;
  let ignored = 0;

  for (const queueMessageEntry of messages) {
    const message = queueMessageEntry?.body;
    if (!validAlbumMessage(message)) {
      queueMessageEntry.ack?.();
      ignored += 1;
      continue;
    }
    if (!(await activeRunMatches(db, message))) {
      queueMessageEntry.ack?.();
      ignored += 1;
      continue;
    }
    try {
      const result = await collectAlbum(env, message, dependencies);
      if (result.stale) {
        queueMessageEntry.ack?.();
        ignored += 1;
        continue;
      }
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
  return { processed, failed, ignored };
}
