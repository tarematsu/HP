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

export const DEFAULT_ALBUM_TRACKS_QUERY_HASH =
  'b9bfabef66ed756e5e13f68a942deb60bd4125ec1f1be8cc42769dc0259b4b10';

const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';
const SPOTIFY_API_BASE = 'https://api.spotify.com/v1';
const SPOTIFY_WEB_TOKEN_URL =
  'https://open.spotify.com/get_access_token?reason=transport&productType=web_player';
const DEFAULT_SPOTIFY_GRAPHQL_URL = 'https://api-partner.spotify.com/pathfinder/v1/query';
const MAX_CATALOG_PAGES = 20;
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

export function albumTracksRequestUrl(
  albumId,
  queryHash = DEFAULT_ALBUM_TRACKS_QUERY_HASH,
  endpoint = DEFAULT_SPOTIFY_GRAPHQL_URL,
) {
  const id = safeText(albumId);
  const hash = safeText(queryHash);
  if (!id) throw new TypeError('albumId is required');
  if (!hash) throw new TypeError('queryHash is required');
  const url = new URL(endpoint);
  url.searchParams.set('operationName', 'queryAlbumTracks');
  url.searchParams.set('variables', JSON.stringify({
    uri: `spotify:album:${id}`,
    offset: 0,
    limit: 300,
  }));
  url.searchParams.set('extensions', JSON.stringify({
    persistedQuery: {
      version: 1,
      sha256Hash: hash,
    },
  }));
  return url.toString();
}

async function responseJson(response, label) {
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`${label} failed: HTTP ${response.status}${detail ? ` ${detail.slice(0, 240)}` : ''}`);
  }
  return response.json();
}

async function spotifyOfficialAccessToken(env, fetchImpl = fetch) {
  const clientId = safeText(env?.SPOTIFY_CLIENT_ID);
  const clientSecret = safeText(env?.SPOTIFY_CLIENT_SECRET);
  if (!clientId || !clientSecret) {
    throw new Error('SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET must be configured');
  }
  const response = await fetchImpl(SPOTIFY_TOKEN_URL, {
    method: 'POST',
    headers: {
      authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const payload = await responseJson(response, 'Spotify client credentials');
  const token = safeText(payload?.access_token);
  if (!token) throw new Error('Spotify client credentials response did not include access_token');
  return token;
}

async function spotifyWebAccessToken(env, fetchImpl = fetch) {
  const configured = safeText(env?.SPOTIFY_WEB_ACCESS_TOKEN);
  if (configured) return configured;
  const tokenUrl = safeText(env?.SPOTIFY_WEB_TOKEN_URL, SPOTIFY_WEB_TOKEN_URL);
  const response = await fetchImpl(tokenUrl, {
    headers: {
      accept: 'application/json',
      'user-agent': 'Mozilla/5.0 SpotifyWebPlayer/1.0',
    },
  });
  const payload = await responseJson(response, 'Spotify Web Player token');
  const token = safeText(payload?.accessToken || payload?.access_token);
  if (!token) throw new Error('Spotify Web Player token response did not include access token');
  return token;
}

async function listArtistReleases(artist, token, env, fetchImpl = fetch) {
  const market = safeText(env?.SPOTIFY_MARKET, 'JP').toUpperCase();
  const releases = new Map();
  const first = new URL(`${SPOTIFY_API_BASE}/artists/${artist.spotify_artist_id}/albums`);
  first.searchParams.set('include_groups', 'album,single,appears_on');
  first.searchParams.set('market', market);
  first.searchParams.set('limit', '50');

  let next = first.toString();
  for (let page = 0; next && page < MAX_CATALOG_PAGES; page += 1) {
    const response = await fetchImpl(next, {
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${token}`,
      },
    });
    const payload = await responseJson(response, `Spotify releases for ${artist.artist_key}`);
    for (const release of payload?.items || []) {
      const albumId = safeText(release?.id);
      if (!albumId) continue;
      releases.set(albumId, {
        album_id: albumId,
        name: safeText(release?.name),
        album_type: safeText(release?.album_type),
        release_date: safeText(release?.release_date),
        release_date_precision: safeText(release?.release_date_precision),
        total_tracks: integer(release?.total_tracks),
      });
    }
    const candidate = safeText(payload?.next);
    if (!candidate) {
      next = '';
      continue;
    }
    const nextUrl = new URL(candidate);
    if (nextUrl.origin !== 'https://api.spotify.com') {
      throw new Error(`unexpected Spotify pagination origin: ${nextUrl.origin}`);
    }
    next = nextUrl.toString();
  }
  if (next) throw new Error(`Spotify catalog pagination exceeded ${MAX_CATALOG_PAGES} pages`);
  return [...releases.values()];
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
      ) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(album_id) DO UPDATE SET
        name=excluded.name,
        album_type=excluded.album_type,
        release_date=excluded.release_date,
        release_date_precision=excluded.release_date_precision,
        total_tracks=excluded.total_tracks,
        last_seen_at=excluded.last_seen_at`)
        .bind(
          release.album_id,
          release.name,
          release.album_type,
          release.release_date,
          release.release_date_precision,
          release.total_tracks,
          seenAt,
        ),
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
  const token = await spotifyOfficialAccessToken(env, fetchImpl);
  const seenAt = Date.now();
  let releasesSeen = 0;
  for (const artist of SPOTIFY_TARGET_ARTISTS) {
    const releases = await listArtistReleases(artist, token, env, fetchImpl);
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
    ORDER BY r.release_date,r.album_id`).all();
  const bodies = resultsOf(query).map((row) => queueMessage(snapshotDate, row)).filter(Boolean);
  await db.prepare(`UPDATE sh_spotify_collection_runs
    SET albums_queued=?,status=?,updated_at=?
    WHERE snapshot_date=?`)
    .bind(bodies.length, bodies.length ? 'queued' : 'complete', Date.now(), snapshotDate)
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

export function normalizeAlbumTracks(payload, targets) {
  const targetBySpotifyId = new Map(
    (targets || []).map((target) => [safeText(target?.spotify_artist_id), target]).filter(([id]) => id),
  );
  const album = payload?.data?.albumUnion || payload?.data?.album;
  const items = Array.isArray(album?.tracks?.items) ? album.tracks.items : [];
  const normalized = [];
  for (const item of items) {
    const rawTrack = item?.track || item;
    const id = trackId(rawTrack);
    const playcount = integer(rawTrack?.playcount);
    if (!id || playcount == null || playcount < 0) continue;
    const artists = artistIds(rawTrack?.artists?.items || rawTrack?.artists);
    const matchedTargets = artists
      .map(({ id: artistId }) => targetBySpotifyId.get(artistId))
      .filter(Boolean);
    if (!matchedTargets.length) continue;
    const durationMs = integer(
      rawTrack?.duration?.totalMilliseconds
      ?? rawTrack?.duration_ms
      ?? rawTrack?.durationMs,
    );
    normalized.push({
      track_id: id,
      name: safeText(rawTrack?.name),
      playcount,
      disc_number: integer(rawTrack?.discNumber ?? rawTrack?.disc_number),
      track_number: integer(rawTrack?.trackNumber ?? rawTrack?.track_number),
      duration_ms: durationMs,
      artists_json: JSON.stringify(artists),
      target_keys: [...new Set(matchedTargets.map((target) => target.artist_key))],
    });
  }
  return normalized;
}

async function albumPlaycountPayload(albumId, token, env, fetchImpl = fetch) {
  const queryHash = safeText(
    env?.SPOTIFY_ALBUM_TRACKS_QUERY_HASH,
    DEFAULT_ALBUM_TRACKS_QUERY_HASH,
  );
  const endpoint = safeText(env?.SPOTIFY_PARTNER_ENDPOINT, DEFAULT_SPOTIFY_GRAPHQL_URL);
  const headers = {
    accept: 'application/json',
    authorization: `Bearer ${token}`,
    'app-platform': 'WebPlayer',
    'spotify-app-version': safeText(env?.SPOTIFY_WEB_APP_VERSION, '1.2.75.0'),
    'user-agent': 'Mozilla/5.0 SpotifyWebPlayer/1.0',
  };
  const clientToken = safeText(env?.SPOTIFY_WEB_CLIENT_TOKEN);
  if (clientToken) headers['client-token'] = clientToken;
  const response = await fetchImpl(albumTracksRequestUrl(albumId, queryHash, endpoint), { headers });
  const payload = await responseJson(response, `Spotify album playcount ${albumId}`);
  if (Array.isArray(payload?.errors) && payload.errors.length) {
    throw new Error(`Spotify GraphQL returned errors for ${albumId}: ${JSON.stringify(payload.errors).slice(0, 500)}`);
  }
  return payload;
}

async function previousPlaycounts(db, trackIds) {
  if (!trackIds.length) return new Map();
  const placeholders = trackIds.map(() => '?').join(',');
  const result = await db.prepare(
    `SELECT track_id,playcount FROM sh_spotify_playcount_current WHERE track_id IN (${placeholders})`,
  ).bind(...trackIds).all();
  return new Map(resultsOf(result).map((row) => [String(row.track_id), integer(row.playcount)]));
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
          album_id=excluded.album_id,
          name=excluded.name,
          disc_number=excluded.disc_number,
          track_number=excluded.track_number,
          duration_ms=excluded.duration_ms,
          artists_json=excluded.artists_json,
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

async function collectAlbum(env, message, token, dependencies = {}) {
  const db = env?.OTHER_DB;
  const fetchImpl = dependencies.fetch || fetch;
  const payload = await albumPlaycountPayload(message.album_id, token, env, fetchImpl);
  const tracks = normalizeAlbumTracks(payload, message.targets);
  const collectedAt = Date.now();
  await persistAlbumTracks(db, message, tracks, collectedAt);
  return tracks.length;
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
  if (!messages.length) return { processed: 0 };
  const fetchImpl = dependencies.fetch || fetch;
  const token = await spotifyWebAccessToken(env, fetchImpl);
  let processed = 0;
  let failed = 0;

  for (const queueMessageEntry of messages) {
    const message = queueMessageEntry?.body;
    if (!validAlbumMessage(message)) {
      queueMessageEntry.ack?.();
      continue;
    }
    try {
      const trackCount = await collectAlbum(env, message, token, dependencies);
      await completeAlbum(db, message, trackCount);
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
