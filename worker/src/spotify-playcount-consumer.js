import {
  activeRunMatches,
  batchStatements,
  enabled,
  integer,
  logEvent,
  previousDateKey,
  readRun,
  resultsOf,
  safeText,
  truncateError,
} from './spotify-playcount-common.js';
import {
  fetchAlbumPlaycountPayload,
  fetchAnonymousSession,
  normalizeAlbumTracks,
} from './spotify-playcount-source.js';

async function persistCandidateTracks(db, message, tracks, collectedAt) {
  const writes = [];
  for (const track of tracks) {
    writes.push(
      db.prepare(`INSERT OR IGNORE INTO sh_spotify_tracks (
          track_id,album_id,name,disc_number,track_number,duration_ms,artists_json,updated_at
        ) VALUES (?,?,?,?,?,?,?,?)`)
        .bind(track.track_id, message.album_id, track.name, track.disc_number,
          track.track_number, track.duration_ms, track.artists_json, collectedAt),
      db.prepare(`INSERT INTO sh_spotify_playcount_candidates (
          snapshot_date,run_token,track_id,album_id,playcount,collected_at
        ) SELECT ?,?,?,?,?,? WHERE EXISTS (
          SELECT 1 FROM sh_spotify_collection_runs
          WHERE snapshot_date=? AND run_token=? AND status!='complete'
        ) ON CONFLICT(snapshot_date,track_id) DO UPDATE SET
          run_token=excluded.run_token,album_id=excluded.album_id,
          playcount=excluded.playcount,collected_at=excluded.collected_at
        WHERE EXISTS (
          SELECT 1 FROM sh_spotify_collection_runs
          WHERE snapshot_date=? AND run_token=? AND status!='complete'
        )`)
        .bind(
          message.snapshot_date, message.run_token, track.track_id, message.album_id,
          track.playcount, collectedAt, message.snapshot_date, message.run_token,
          message.snapshot_date, message.run_token,
        ),
    );
    for (const artistKey of track.target_keys) {
      writes.push(db.prepare(`INSERT OR IGNORE INTO sh_spotify_track_targets (track_id,artist_key) VALUES (?,?)`)
        .bind(track.track_id, artistKey));
    }
  }
  await batchStatements(db, writes);
}

async function collectAlbum(env, message, session, dependencies) {
  const payload = await fetchAlbumPlaycountPayload(
    message.album_id, env, session, dependencies.fetch || fetch,
  );
  const tracks = normalizeAlbumTracks(payload, message.targets);
  if (!tracks.length) throw new Error(`Spotify album ${message.album_id} returned no target playcount tracks`);
  if (!(await activeRunMatches(env.OTHER_DB, message))) return { trackCount: 0, stale: true };
  await persistCandidateTracks(env.OTHER_DB, message, tracks, Date.now());
  return { trackCount: tracks.length, stale: false };
}

export function hasPlaycountAdvance(previousRows, candidateRows) {
  const previous = new Map((previousRows || []).map((row) => [String(row.track_id), integer(row.playcount)]));
  if (!previous.size) return true;
  for (const row of candidateRows || []) {
    const oldValue = previous.get(String(row.track_id));
    const newValue = integer(row.playcount);
    if (oldValue != null && newValue != null && newValue > oldValue) return true;
  }
  return false;
}

async function failRun(db, message, error) {
  await db.prepare(`UPDATE sh_spotify_collection_runs
    SET status='error',errors=errors+1,updated_at=?,last_error=?
    WHERE snapshot_date=? AND run_token=?`)
    .bind(Date.now(), truncateError(error), message.snapshot_date, message.run_token).run();
}

async function finalizeAttempt(db, message) {
  const run = await readRun(db, message.snapshot_date);
  if (!run || run.run_token !== message.run_token || run.status === 'complete') return { staleMessage: true };
  if (Number(run.albums_completed || 0) < Number(run.albums_queued || 0)) return { pending: true };

  const candidateResult = await db.prepare(`SELECT track_id,playcount,collected_at
    FROM sh_spotify_playcount_candidates WHERE snapshot_date=? AND run_token=? ORDER BY track_id`)
    .bind(message.snapshot_date, message.run_token).all();
  const candidates = resultsOf(candidateResult);
  if (!candidates.length) {
    await failRun(db, message, new Error('Spotify attempt collected no tracks'));
    return { error: true };
  }

  const previousDate = previousDateKey(message.snapshot_date);
  const previous = resultsOf(await db.prepare(`SELECT track_id,playcount
    FROM sh_spotify_playcount_daily WHERE snapshot_date=? ORDER BY track_id`)
    .bind(previousDate).all());
  if (previous.length) {
    const candidateIds = new Set(candidates.map((row) => String(row.track_id)));
    const missing = previous.filter((row) => !candidateIds.has(String(row.track_id)));
    if (missing.length) {
      const now = Date.now();
      const detail = `candidate snapshot is missing ${missing.length} tracks from ${previousDate}`;
      await db.prepare(`UPDATE sh_spotify_collection_runs
        SET status='incomplete',updated_at=?,completed_at=?,last_error=?
        WHERE snapshot_date=? AND run_token=?`)
        .bind(now, now, detail, message.snapshot_date, message.run_token).run();
      return { incomplete: true, missing: missing.length };
    }
    if (!hasPlaycountAdvance(previous, candidates)) {
      const now = Date.now();
      await db.prepare(`UPDATE sh_spotify_collection_runs
        SET status='stale',updated_at=?,completed_at=?,
            last_error='Spotify playcounts have not advanced from the previous day'
        WHERE snapshot_date=? AND run_token=?`)
        .bind(now, now, message.snapshot_date, message.run_token).run();
      return { stale: true };
    }
  }

  const previousMap = new Map(previous.map((row) => [String(row.track_id), integer(row.playcount)]));
  const writes = [];
  for (const row of candidates) {
    const trackId = String(row.track_id);
    const playcount = integer(row.playcount);
    if (playcount == null || playcount < 0) continue;
    const oldValue = previousMap.get(trackId);
    const delta = oldValue == null || playcount < oldValue ? null : playcount - oldValue;
    writes.push(
      db.prepare(`INSERT INTO sh_spotify_playcount_daily (
          snapshot_date,track_id,playcount,delta,collected_at,is_carried_forward
        ) VALUES (?,?,?,?,?,0) ON CONFLICT(snapshot_date,track_id) DO UPDATE SET
          playcount=excluded.playcount,delta=excluded.delta,
          collected_at=excluded.collected_at,is_carried_forward=0`)
        .bind(message.snapshot_date, trackId, playcount, delta, row.collected_at),
      db.prepare(`INSERT INTO sh_spotify_playcount_current (track_id,playcount,snapshot_date,collected_at)
        VALUES (?,?,?,?) ON CONFLICT(track_id) DO UPDATE SET
          playcount=excluded.playcount,snapshot_date=excluded.snapshot_date,collected_at=excluded.collected_at`)
        .bind(trackId, playcount, message.snapshot_date, row.collected_at),
    );
  }
  await batchStatements(db, writes);
  const now = Date.now();
  await db.prepare(`UPDATE sh_spotify_collection_runs
    SET status='complete',tracks_collected=?,errors=0,completed_at=?,updated_at=?,last_error=NULL
    WHERE snapshot_date=? AND run_token=?`)
    .bind(candidates.length, now, now, message.snapshot_date, message.run_token).run();
  logEvent('spotify_playcount_complete', { snapshot_date: message.snapshot_date, tracks: candidates.length });
  return { complete: true, tracks: candidates.length };
}

async function completeAlbum(db, message, trackCount) {
  const now = Date.now();
  await db.prepare(`INSERT INTO sh_spotify_collection_album_runs (
      snapshot_date,run_token,album_id,status,track_count,attempts,last_error,updated_at
    ) VALUES (?,?,?,'complete',?,1,NULL,?) ON CONFLICT(snapshot_date,album_id) DO UPDATE SET
      run_token=excluded.run_token,status='complete',track_count=excluded.track_count,
      attempts=sh_spotify_collection_album_runs.attempts+1,last_error=NULL,updated_at=excluded.updated_at`)
    .bind(message.snapshot_date, message.run_token, message.album_id, trackCount, now).run();
  await db.prepare(`UPDATE sh_spotify_collection_runs SET
      albums_completed=(SELECT COUNT(*) FROM sh_spotify_collection_album_runs
        WHERE snapshot_date=? AND run_token=? AND status='complete'),
      errors=(SELECT COUNT(*) FROM sh_spotify_collection_album_runs
        WHERE snapshot_date=? AND run_token=? AND status='error'),updated_at=?
    WHERE snapshot_date=? AND run_token=?`)
    .bind(message.snapshot_date, message.run_token, message.snapshot_date, message.run_token,
      now, message.snapshot_date, message.run_token).run();
  return finalizeAttempt(db, message);
}

async function recordAlbumError(db, message, error) {
  const now = Date.now();
  const detail = truncateError(error);
  await db.prepare(`INSERT INTO sh_spotify_collection_album_runs (
      snapshot_date,run_token,album_id,status,track_count,attempts,last_error,updated_at
    ) VALUES (?,?,?,'error',0,1,?,?) ON CONFLICT(snapshot_date,album_id) DO UPDATE SET
      run_token=excluded.run_token,
      status=CASE WHEN sh_spotify_collection_album_runs.run_token=excluded.run_token
        AND sh_spotify_collection_album_runs.status='complete' THEN 'complete' ELSE 'error' END,
      attempts=sh_spotify_collection_album_runs.attempts+1,
      last_error=CASE WHEN sh_spotify_collection_album_runs.run_token=excluded.run_token
        AND sh_spotify_collection_album_runs.status='complete' THEN NULL ELSE excluded.last_error END,
      updated_at=excluded.updated_at`)
    .bind(message.snapshot_date, message.run_token, message.album_id, detail, now).run();
  await db.prepare(`UPDATE sh_spotify_collection_runs SET
      errors=(SELECT COUNT(*) FROM sh_spotify_collection_album_runs
        WHERE snapshot_date=? AND run_token=? AND status='error'),updated_at=?,last_error=?
    WHERE snapshot_date=? AND run_token=?`)
    .bind(message.snapshot_date, message.run_token, now, detail,
      message.snapshot_date, message.run_token).run();
}

function validAlbumMessage(body) {
  if (body?.message_type !== 'spotify-playcount-album' || ![2, 3].includes(Number(body?.message_version))) return false;
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
  const active = [];
  let ignored = 0;
  for (const entry of batch?.messages || []) {
    const message = entry?.body;
    if (!validAlbumMessage(message) || !(await activeRunMatches(db, message))) {
      entry.ack?.();
      ignored += 1;
    } else {
      active.push(entry);
    }
  }
  if (!active.length) return { processed: 0, failed: 0, ignored };

  let session;
  try {
    session = dependencies.session || await fetchAnonymousSession(env, dependencies.fetch || fetch);
  } catch (error) {
    for (const entry of active) entry.retry?.();
    logEvent('spotify_playcount_collection_error', { stage: 'session', error: truncateError(error, 500) });
    if (!active.every((entry) => typeof entry.retry === 'function')) throw error;
    return { processed: 0, failed: active.length, ignored };
  }

  let processed = 0;
  let failed = 0;
  for (const entry of active) {
    const message = entry.body;
    try {
      const result = await collectAlbum(env, message, session, dependencies);
      if (result.stale) {
        entry.ack?.();
        ignored += 1;
        continue;
      }
      await completeAlbum(db, message, result.trackCount);
      entry.ack?.();
      processed += 1;
    } catch (error) {
      failed += 1;
      await recordAlbumError(db, message, error).catch(() => {});
      logEvent('spotify_playcount_collection_error', {
        stage: 'album', snapshot_date: message.snapshot_date,
        album_id: message.album_id, error: truncateError(error, 500),
      });
      if (typeof entry.retry === 'function') entry.retry();
      else throw error;
    }
  }
  logEvent('spotify_playcount_queue_batch', { processed, failed, ignored });
  return { processed, failed, ignored };
}
