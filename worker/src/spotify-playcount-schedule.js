import {
  FIRST_CHECK_HOUR_JST,
  QUEUE_BATCH_SIZE,
  SPOTIFY_CURRENT_TOP20_ARTISTS,
  SPOTIFY_TOP20_RANKING_DATE,
  enabled,
  integer,
  jstDateKey,
  jstHour,
  logEvent,
  readRun,
  resultsOf,
  shouldRetryRun,
  truncateError,
  batchStatements,
} from './spotify-playcount-common.js';
import { discoverArtistReleases, fetchAnonymousSession } from './spotify-playcount-source.js';

async function syncCurrentTop20(db) {
  const writes = [];
  for (const artist of SPOTIFY_CURRENT_TOP20_ARTISTS) {
    writes.push(
      db.prepare(`INSERT INTO sh_spotify_artists (artist_key,spotify_artist_id,artist_name)
        VALUES (?,?,?) ON CONFLICT(artist_key) DO UPDATE SET
          spotify_artist_id=excluded.spotify_artist_id,artist_name=excluded.artist_name`)
        .bind(artist.artist_key, artist.spotify_artist_id, artist.artist_name),
      db.prepare(`INSERT INTO sh_spotify_top20_history (ranking_date,artist_key,rank)
        VALUES (?,?,?) ON CONFLICT(ranking_date,artist_key) DO UPDATE SET rank=excluded.rank`)
        .bind(SPOTIFY_TOP20_RANKING_DATE, artist.artist_key, artist.rank),
    );
  }
  await batchStatements(db, writes);

  const result = await db.prepare(`SELECT artist_key,spotify_artist_id,artist_name
    FROM sh_spotify_artists ORDER BY artist_key`).all();
  return resultsOf(result).map((row) => ({
    artist_key: String(row.artist_key),
    spotify_artist_id: String(row.spotify_artist_id),
    artist_name: String(row.artist_name),
  }));
}

async function refreshArtistCatalog(db, artist, releases, seenAt) {
  const existingResult = await db.prepare(`SELECT album_id,is_active
    FROM sh_spotify_release_targets WHERE artist_key=?`).bind(artist.artist_key).all();
  const existing = new Map(resultsOf(existingResult).map((row) => [String(row.album_id), Number(row.is_active || 0)]));
  const writes = [];
  let changed = 0;
  for (const release of releases) {
    const state = existing.get(release.album_id);
    if (state === 1) continue;
    const releaseInsert = db.prepare(`INSERT INTO sh_spotify_releases (
        album_id,name,album_type,release_date,release_date_precision,total_tracks,last_seen_at
      ) VALUES (?,?,?,?,?,?,?) ON CONFLICT(album_id) DO NOTHING`)
      .bind(release.album_id, release.name, release.album_type, release.release_date,
        release.release_date_precision, release.total_tracks, seenAt);
    if (state === 0) {
      writes.push(
        releaseInsert,
        db.prepare(`UPDATE sh_spotify_release_targets
          SET is_active=1,last_seen_at=? WHERE album_id=? AND artist_key=? AND is_active=0`)
          .bind(seenAt, release.album_id, artist.artist_key),
      );
      changed += 1;
      continue;
    }
    writes.push(
      releaseInsert,
      db.prepare(`INSERT INTO sh_spotify_release_targets (album_id,artist_key,is_active,last_seen_at)
        VALUES (?,?,1,?) ON CONFLICT(album_id,artist_key) DO UPDATE SET is_active=1,last_seen_at=excluded.last_seen_at`)
        .bind(release.album_id, artist.artist_key, seenAt),
    );
    changed += 1;
  }
  await batchStatements(db, writes);
  return changed;
}

async function refreshCatalog(env, dependencies, collectionArtists) {
  const db = env.OTHER_DB;
  const fetchImpl = dependencies.fetch || fetch;
  const session = dependencies.session || await fetchAnonymousSession(env, fetchImpl);
  const seenAt = Date.now();
  let releasesSeen = 0;
  let releasesChanged = 0;
  for (const artist of collectionArtists) {
    const releases = await discoverArtistReleases(artist, env, session, fetchImpl);
    releasesSeen += releases.length;
    releasesChanged += await refreshArtistCatalog(db, artist, releases, seenAt);
  }
  return { releasesSeen, releasesChanged };
}

function queueMessage(snapshotDate, runToken, row, collectionArtists) {
  const targetByKey = new Map(collectionArtists.map((artist) => [artist.artist_key, artist]));
  const targets = String(row?.target_keys || '').split(',')
    .map((value) => targetByKey.get(value.trim())).filter(Boolean)
    .map(({ artist_key, spotify_artist_id }) => ({ artist_key, spotify_artist_id }));
  if (!targets.length) return null;
  return {
    message_type: 'spotify-playcount-album', message_version: 3,
    snapshot_date: snapshotDate, run_token: runToken,
    album_id: String(row.album_id), targets,
  };
}

async function sendQueueBatch(queue, bodies) {
  for (let offset = 0; offset < bodies.length; offset += QUEUE_BATCH_SIZE) {
    const chunk = bodies.slice(offset, offset + QUEUE_BATCH_SIZE);
    if (typeof queue.sendBatch === 'function') {
      await queue.sendBatch(chunk.map((body) => ({ body, contentType: 'json' })));
    } else {
      for (const body of chunk) await queue.send(body, { contentType: 'json' });
    }
  }
}

async function queueActiveReleases(env, snapshotDate, runToken, collectionArtists) {
  const queue = env.SPOTIFY_PLAYCOUNT_QUEUE;
  if (!queue?.send && !queue?.sendBatch) throw new Error('SPOTIFY_PLAYCOUNT_QUEUE binding is required');
  const query = await env.OTHER_DB.prepare(`SELECT r.album_id,GROUP_CONCAT(t.artist_key, ',') AS target_keys
    FROM sh_spotify_releases r
    INNER JOIN sh_spotify_release_targets t ON t.album_id=r.album_id
    WHERE t.is_active=1 GROUP BY r.album_id ORDER BY r.album_id`).all();
  const bodies = resultsOf(query)
    .map((row) => queueMessage(snapshotDate, runToken, row, collectionArtists)).filter(Boolean);
  if (!bodies.length) throw new Error('Spotify catalog contains no active releases to collect');
  await env.OTHER_DB.prepare(`UPDATE sh_spotify_collection_runs
    SET albums_queued=?,status='queued',updated_at=? WHERE snapshot_date=? AND run_token=?`)
    .bind(bodies.length, Date.now(), snapshotDate, runToken).run();
  await sendQueueBatch(queue, bodies);
  return bodies.length;
}

async function oldestIncompleteRun(db, today) {
  return db.prepare(`SELECT snapshot_date,status,updated_at FROM sh_spotify_collection_runs
    WHERE snapshot_date < ? AND status != 'complete' ORDER BY snapshot_date LIMIT 1`)
    .bind(today).first();
}

async function selectScheduledSnapshot(db, scheduledTime) {
  const today = jstDateKey(scheduledTime);
  const todayRun = await readRun(db, today);
  if (todayRun?.status === 'complete') return { skip: 'complete' };
  const older = await oldestIncompleteRun(db, today);
  if (older) return shouldRetryRun(older, scheduledTime) ? { snapshotDate: older.snapshot_date } : { skip: 'in-flight' };
  if (jstHour(scheduledTime) < FIRST_CHECK_HOUR_JST && !todayRun) return { skip: 'before-05:00' };
  return shouldRetryRun(todayRun, scheduledTime) ? { snapshotDate: today } : { skip: 'in-flight' };
}

async function beginAttempt(db, snapshotDate, attemptNo, runToken, startedAt) {
  await db.prepare(`INSERT INTO sh_spotify_collection_runs (
      snapshot_date,status,attempt_no,run_token,albums_queued,albums_completed,
      tracks_collected,errors,started_at,attempt_started_at,completed_at,updated_at,last_error
    ) VALUES (?,'catalog',?,?,0,0,0,0,?,?,NULL,?,NULL)
    ON CONFLICT(snapshot_date) DO UPDATE SET
      status='catalog',attempt_no=excluded.attempt_no,run_token=excluded.run_token,
      albums_queued=0,albums_completed=0,tracks_collected=0,errors=0,
      attempt_started_at=excluded.attempt_started_at,completed_at=NULL,
      updated_at=excluded.updated_at,last_error=NULL`)
    .bind(snapshotDate, attemptNo, runToken, startedAt, startedAt, startedAt).run();
  await db.batch([
    db.prepare(`DELETE FROM sh_spotify_collection_album_runs WHERE snapshot_date=?`).bind(snapshotDate),
    db.prepare(`DELETE FROM sh_spotify_playcount_candidates WHERE snapshot_date=?`).bind(snapshotDate),
  ]);
}

async function failRun(db, snapshotDate, runToken, error) {
  await db.prepare(`UPDATE sh_spotify_collection_runs
    SET status='error',errors=errors+1,updated_at=?,last_error=?
    WHERE snapshot_date=? AND run_token=?`)
    .bind(Date.now(), truncateError(error), snapshotDate, runToken).run();
}

export async function runSpotifyPlaycountScheduled(controller, env, dependencies = {}) {
  if (!enabled(env?.SPOTIFY_PLAYCOUNT_ENABLED, true)) {
    logEvent('spotify_playcount_scheduled', { skipped: true, reason: 'disabled' });
    return { skipped: true, reason: 'disabled' };
  }
  const db = env?.OTHER_DB;
  if (!db?.prepare || !db?.batch) throw new Error('OTHER_DB binding is required');

  // sh_spotify_artists is an additive roster: Top 20 entrants are inserted/updated but never removed.
  // Therefore an artist keeps being collected after falling out of the current Top 20.
  const collectionArtists = await syncCurrentTop20(db);
  if (!collectionArtists.length) throw new Error('Spotify collection roster is empty');

  const raw = Number(controller?.scheduledTime);
  const scheduledTime = Number.isFinite(raw) ? raw : Date.now();
  const selection = await selectScheduledSnapshot(db, scheduledTime);
  if (!selection.snapshotDate) {
    logEvent('spotify_playcount_scheduled', {
      skipped: true, reason: selection.skip, collection_artists: collectionArtists.length,
    });
    return { skipped: true, reason: selection.skip };
  }
  const snapshotDate = selection.snapshotDate;
  const existing = await readRun(db, snapshotDate);
  const attemptNo = Math.max(0, integer(existing?.attempt_no) ?? 0) + 1;
  const runToken = `${snapshotDate}:${scheduledTime}:${attemptNo}`;
  await beginAttempt(db, snapshotDate, attemptNo, runToken, Date.now());
  try {
    let catalog = { releasesSeen: 0, releasesChanged: 0 };
    const refreshNeeded = !existing
      || Number(existing.albums_queued || 0) === 0
      || Number(existing.errors || 0) > 0
      || ['error', 'incomplete'].includes(String(existing.status || ''));
    if (refreshNeeded) catalog = await refreshCatalog(env, dependencies, collectionArtists);
    const albumsQueued = await queueActiveReleases(env, snapshotDate, runToken, collectionArtists);
    const result = {
      ok: true, snapshot_date: snapshotDate, attempt_no: attemptNo,
      collection_artists: collectionArtists.length,
      releases_seen: catalog.releasesSeen, releases_changed: catalog.releasesChanged,
      albums_queued: albumsQueued,
    };
    logEvent('spotify_playcount_scheduled', result);
    return result;
  } catch (error) {
    await failRun(db, snapshotDate, runToken, error).catch(() => {});
    logEvent('spotify_playcount_collection_error', {
      stage: 'schedule', snapshot_date: snapshotDate, attempt_no: attemptNo,
      error: truncateError(error, 500),
    });
    throw error;
  }
}
