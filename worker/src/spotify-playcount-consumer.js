import { spotifyDailyFinalizeStatement } from './spotify-playcount-daily-write.js';
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
  SPOTIFY_TARGET_ARTISTS,
  truncateError,
} from './spotify-playcount-common.js';
import {
  fetchAlbumPlaycountPayload,
  fetchAnonymousSession,
  normalizeAlbumTracks,
} from './spotify-playcount-source.js';
import {
  bootstrapSpotifyTrackAliases,
  resolveCanonicalSpotifyTracks,
} from './spotify-track-identity.js';
import { spotifyArtistDailyRefreshStatements } from './spotify-playcount-summary.js';

async function persistCandidateTracks(db, message, tracks, collectedAt) {
  const resolvedTracks = await resolveCanonicalSpotifyTracks(db, tracks, collectedAt);
  const writes = [];
  for (const track of resolvedTracks) {
    if (!track.identity_cached) {
      writes.push(
        db.prepare(`INSERT OR IGNORE INTO sh_spotify_tracks (
            track_id,album_id,name,disc_number,track_number,duration_ms,artists_json,updated_at
          ) VALUES (?,?,?,?,?,?,?,?)`)
          .bind(track.track_id, message.album_id, track.name, track.disc_number,
            track.track_number, track.duration_ms, track.artists_json, collectedAt),
      );
    }
    writes.push(
      db.prepare(`INSERT INTO sh_spotify_playcount_candidates (
          snapshot_date,run_token,track_id,album_id,playcount,collected_at
        ) SELECT ?,?,?,?,?,? WHERE EXISTS (
          SELECT 1 FROM sh_spotify_collection_runs
          WHERE snapshot_date=? AND run_token=? AND status IN ('catalog','queued')
        ) ON CONFLICT(snapshot_date,track_id) DO UPDATE SET
          run_token=excluded.run_token,
          album_id=CASE
            WHEN sh_spotify_playcount_candidates.run_token=excluded.run_token
              AND sh_spotify_playcount_candidates.playcount>excluded.playcount
            THEN sh_spotify_playcount_candidates.album_id ELSE excluded.album_id END,
          playcount=CASE
            WHEN sh_spotify_playcount_candidates.run_token=excluded.run_token
            THEN MAX(sh_spotify_playcount_candidates.playcount,excluded.playcount)
            ELSE excluded.playcount END,
          collected_at=CASE
            WHEN sh_spotify_playcount_candidates.run_token=excluded.run_token
              AND sh_spotify_playcount_candidates.playcount>excluded.playcount
            THEN sh_spotify_playcount_candidates.collected_at
            WHEN sh_spotify_playcount_candidates.run_token=excluded.run_token
              AND sh_spotify_playcount_candidates.playcount=excluded.playcount
            THEN MAX(sh_spotify_playcount_candidates.collected_at,excluded.collected_at)
            ELSE excluded.collected_at END
        WHERE EXISTS (
          SELECT 1 FROM sh_spotify_collection_runs
          WHERE snapshot_date=? AND run_token=? AND status IN ('catalog','queued')
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

function rawTrackArtistCoverage(rawItems, targets) {
  const targetIds = new Set(
    (targets || []).map((target) => safeText(target?.spotify_artist_id)).filter(Boolean),
  );
  let complete = Array.isArray(rawItems) && rawItems.length > 0;
  let hasTargetCredit = false;
  for (const item of rawItems || []) {
    const rawTrack = item?.track || item;
    const artists = rawTrack?.artists?.items;
    if (!Array.isArray(artists) || !artists.length) {
      complete = false;
      continue;
    }
    let hasValidArtist = false;
    for (const entry of artists) {
      const artist = entry?.artist || entry;
      const directId = safeText(artist?.id);
      const uri = safeText(artist?.uri);
      const artistId = directId || (uri.startsWith('spotify:artist:') ? uri.slice('spotify:artist:'.length) : '');
      if (!artistId) continue;
      hasValidArtist = true;
      if (targetIds.has(artistId)) hasTargetCredit = true;
    }
    if (!hasValidArtist) complete = false;
  }
  return { complete, hasTargetCredit };
}

async function collectAlbum(env, message, session, dependencies) {
  const payload = await fetchAlbumPlaycountPayload(
    message.album_id, env, session, dependencies.fetch || fetch,
  );
  if (!(await activeRunMatches(env.OTHER_DB, message))) {
    return { trackCount: 0, stale: true, unrelated: false };
  }
  const rawItems = Array.isArray(payload?.data?.album?.tracks?.items)
    ? payload.data.album.tracks.items
    : [];
  const tracks = normalizeAlbumTracks(payload, message.targets);
  if (!tracks.length) {
    const coverage = rawTrackArtistCoverage(rawItems, message.targets);
    if (coverage.complete && !coverage.hasTargetCredit) {
      return { trackCount: 0, stale: false, unrelated: true };
    }
    throw new Error(`Spotify album ${message.album_id} returned no target playcount tracks`);
  }
  await persistCandidateTracks(env.OTHER_DB, message, tracks, Date.now());
  return { trackCount: tracks.length, stale: false, unrelated: false };
}

async function deactivateUnrelatedRelease(db, message) {
  const targetKeys = (message.targets || [])
    .map((target) => safeText(target?.artist_key))
    .filter(Boolean);
  if (!targetKeys.length) return;
  const placeholders = targetKeys.map(() => '?').join(',');
  await db.prepare(`UPDATE sh_spotify_release_targets
    SET is_active=0
    WHERE album_id=? AND artist_key IN (${placeholders})
      AND EXISTS (
        SELECT 1 FROM sh_spotify_collection_runs
        WHERE snapshot_date=? AND run_token=? AND status IN ('catalog','queued')
      )`)
    .bind(
      message.album_id, ...targetKeys,
      message.snapshot_date, message.run_token,
    )
    .run();
}

// Historical export name retained for compatibility. A published adjustment can move up or down.
export function hasPlaycountAdvance(previousRows, candidateRows) {
  const previous = new Map((previousRows || []).map((row) => [String(row.track_id), integer(row.playcount)]));
  if (!previous.size) return true;
  for (const row of candidateRows || []) {
    const oldValue = previous.get(String(row.track_id));
    const newValue = integer(row.playcount);
    if (oldValue != null && newValue != null && newValue !== oldValue) return true;
  }
  return false;
}

export function countPlaycountRegressions(previousRows, candidateRows) {
  const candidates = new Map((candidateRows || []).map((row) => [String(row.track_id), integer(row.playcount)]));
  let regressions = 0;
  for (const row of previousRows || []) {
    const oldValue = integer(row.playcount);
    const newValue = candidates.get(String(row.track_id));
    if (oldValue != null && newValue != null && newValue < oldValue) regressions += 1;
  }
  return regressions;
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
  if (run.status === 'finalizing') return { finalizing: true };
  if (!['catalog', 'queued'].includes(String(run.status))) return { staleMessage: true };
  if (Number(run.albums_completed || 0) < Number(run.albums_queued || 0)) return { pending: true };

  // Claim finalization before reading the candidate/previous-day sets. Multiple
  // queue consumers can observe albums_completed>=albums_queued concurrently;
  // only the winner should pay for the heavy validation reads.
  const claimTime = Date.now();
  const claim = await db.prepare(`UPDATE sh_spotify_collection_runs
    SET status='finalizing',updated_at=?
    WHERE snapshot_date=? AND run_token=? AND status IN ('catalog','queued')
      AND albums_completed>=albums_queued`)
    .bind(claimTime, message.snapshot_date, message.run_token).run();
  if (Number(claim?.meta?.changes || 0) !== 1) return { finalizing: true };

  const candidateResult = await db.prepare(`SELECT track_id,playcount,collected_at
    FROM sh_spotify_playcount_candidates WHERE snapshot_date=? AND run_token=? ORDER BY track_id`)
    .bind(message.snapshot_date, message.run_token).all();
  const candidates = resultsOf(candidateResult);
  if (!candidates.length) {
    await failRun(db, message, new Error('Spotify attempt collected no tracks'));
    return { error: true };
  }

  const previousDate = previousDateKey(message.snapshot_date);
  const targetKeys = SPOTIFY_TARGET_ARTISTS.map((artist) => artist.artist_key);
  const placeholders = targetKeys.map(() => '?').join(',');
  const previous = resultsOf(await db.prepare(`SELECT DISTINCT d.track_id,d.playcount
    FROM sh_spotify_playcount_daily_canonical d
    INNER JOIN sh_spotify_track_targets t ON t.track_id=d.track_id
    WHERE d.snapshot_date=? AND t.artist_key IN (${placeholders})
    ORDER BY d.track_id`)
    .bind(previousDate, ...targetKeys).all());
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
    const regressions = countPlaycountRegressions(previous, candidates);
    if (regressions) {
      logEvent('spotify_playcount_adjustment', {
        snapshot_date: message.snapshot_date,
        previous_date: previousDate,
        decreased_tracks: regressions,
      });
    }
    if (!hasPlaycountAdvance(previous, candidates)) {
      const now = Date.now();
      await db.prepare(`UPDATE sh_spotify_collection_runs
        SET status='stale',updated_at=?,completed_at=?,
            last_error='Spotify playcounts have not changed from the previous day'
        WHERE snapshot_date=? AND run_token=?`)
        .bind(now, now, message.snapshot_date, message.run_token).run();
      return { stale: true };
    }
  }

  const now = Date.now();
  await db.batch([
    spotifyDailyFinalizeStatement(db, message, previousDate),
    db.prepare(`DELETE FROM sh_spotify_playcount_daily
      WHERE snapshot_date=? AND track_id IN (
        SELECT source_track_id FROM sh_spotify_track_aliases
        WHERE source_track_id<>canonical_track_id
      )`)
      .bind(message.snapshot_date),
    ...spotifyArtistDailyRefreshStatements(db, message.snapshot_date, now),
    db.prepare(`INSERT INTO sh_spotify_playcount_current (
        track_id,playcount,snapshot_date,collected_at
      )
      SELECT c.track_id,c.playcount,?,c.collected_at
      FROM sh_spotify_playcount_candidates c
      WHERE c.snapshot_date=? AND c.run_token=?
      ON CONFLICT(track_id) DO UPDATE SET
        playcount=excluded.playcount,snapshot_date=excluded.snapshot_date,collected_at=excluded.collected_at
      WHERE excluded.snapshot_date>=sh_spotify_playcount_current.snapshot_date`)
      .bind(message.snapshot_date, message.snapshot_date, message.run_token),
    db.prepare(`DELETE FROM sh_spotify_playcount_current
      WHERE track_id IN (
        SELECT source_track_id FROM sh_spotify_track_aliases
        WHERE source_track_id<>canonical_track_id
      )`),
    db.prepare(`UPDATE sh_spotify_collection_runs
      SET status='complete',tracks_collected=?,errors=0,completed_at=?,updated_at=?,last_error=NULL
      WHERE snapshot_date=? AND run_token=? AND status='finalizing'`)
      .bind(candidates.length, now, now, message.snapshot_date, message.run_token),
    db.prepare(`DELETE FROM sh_spotify_playcount_candidates
      WHERE snapshot_date=? AND run_token=?`)
      .bind(message.snapshot_date, message.run_token),
    db.prepare(`DELETE FROM sh_spotify_collection_album_runs
      WHERE snapshot_date=? AND run_token=?`)
      .bind(message.snapshot_date, message.run_token),
  ]);
  logEvent('spotify_playcount_complete', { snapshot_date: message.snapshot_date, tracks: candidates.length });
  return { complete: true, tracks: candidates.length };
}

export async function updateAlbumProgress(db, message, outcome, now = Date.now()) {
  if (outcome?.status === 'complete') {
    const trackCount = Math.max(0, integer(outcome.trackCount) ?? 0);
    await db.batch([
      db.prepare(`UPDATE sh_spotify_collection_runs SET
          albums_completed=albums_completed+CASE
            WHEN EXISTS (
              SELECT 1 FROM sh_spotify_collection_album_runs
              WHERE snapshot_date=? AND album_id=? AND run_token=? AND status='complete'
            ) THEN 0 ELSE 1 END,
          errors=MAX(0,errors-CASE
            WHEN EXISTS (
              SELECT 1 FROM sh_spotify_collection_album_runs
              WHERE snapshot_date=? AND album_id=? AND run_token=? AND status='error'
            ) THEN 1 ELSE 0 END),
          updated_at=?
        WHERE snapshot_date=? AND run_token=? AND status IN ('catalog','queued')`)
        .bind(
          message.snapshot_date, message.album_id, message.run_token,
          message.snapshot_date, message.album_id, message.run_token,
          now, message.snapshot_date, message.run_token,
        ),
      db.prepare(`INSERT INTO sh_spotify_collection_album_runs (
          snapshot_date,run_token,album_id,status,track_count,attempts,last_error,updated_at
        ) SELECT ?,?,?,'complete',?,1,NULL,? WHERE EXISTS (
          SELECT 1 FROM sh_spotify_collection_runs
          WHERE snapshot_date=? AND run_token=? AND status IN ('catalog','queued')
        ) ON CONFLICT(snapshot_date,album_id) DO UPDATE SET
          run_token=excluded.run_token,status='complete',track_count=excluded.track_count,
          attempts=sh_spotify_collection_album_runs.attempts+1,last_error=NULL,updated_at=excluded.updated_at`)
        .bind(
          message.snapshot_date, message.run_token, message.album_id, trackCount, now,
          message.snapshot_date, message.run_token,
        ),
    ]);
    return;
  }

  if (outcome?.status !== 'error') throw new Error('Spotify album outcome must be complete or error');
  const detail = truncateError(outcome.error);
  await db.batch([
    db.prepare(`UPDATE sh_spotify_collection_runs SET
        errors=errors+CASE
          WHEN EXISTS (
            SELECT 1 FROM sh_spotify_collection_album_runs
            WHERE snapshot_date=? AND album_id=? AND run_token=? AND status IN ('complete','error')
          ) THEN 0 ELSE 1 END,
        updated_at=?,last_error=?
      WHERE snapshot_date=? AND run_token=? AND status IN ('catalog','queued')`)
      .bind(
        message.snapshot_date, message.album_id, message.run_token,
        now, detail, message.snapshot_date, message.run_token,
      ),
    db.prepare(`INSERT INTO sh_spotify_collection_album_runs (
        snapshot_date,run_token,album_id,status,track_count,attempts,last_error,updated_at
      ) SELECT ?,?,?,'error',0,1,?,? WHERE EXISTS (
        SELECT 1 FROM sh_spotify_collection_runs
        WHERE snapshot_date=? AND run_token=? AND status IN ('catalog','queued')
      ) ON CONFLICT(snapshot_date,album_id) DO UPDATE SET
        run_token=excluded.run_token,
        status=CASE WHEN sh_spotify_collection_album_runs.run_token=excluded.run_token
          AND sh_spotify_collection_album_runs.status='complete' THEN 'complete' ELSE 'error' END,
        attempts=sh_spotify_collection_album_runs.attempts+1,
        last_error=CASE WHEN sh_spotify_collection_album_runs.run_token=excluded.run_token
          AND sh_spotify_collection_album_runs.status='complete' THEN NULL ELSE excluded.last_error END,
        updated_at=excluded.updated_at`)
      .bind(
        message.snapshot_date, message.run_token, message.album_id, detail, now,
        message.snapshot_date, message.run_token,
      ),
  ]);
}

async function completeAlbum(db, message, trackCount) {
  await updateAlbumProgress(db, message, { status: 'complete', trackCount });
  return finalizeAttempt(db, message);
}

async function recordAlbumError(db, message, error) {
  await updateAlbumProgress(db, message, { status: 'error', error });
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

  await bootstrapSpotifyTrackAliases(db, Date.now());

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
      if (result.unrelated) await deactivateUnrelatedRelease(db, message);
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
