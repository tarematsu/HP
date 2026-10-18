import { spotifyDailyAliasCleanupStatement, spotifyDailyFinalizeR2Statement, spotifyDailyFinalizeStatement } from './spotify-playcount-daily-write.js';
import {
  cleanupSpotifyR2RunCandidates,
  loadSpotifyR2RunCandidates,
  saveSpotifyR2AlbumCandidates,
  spotifyR2CandidatesEnabled,
} from './spotify-r2-candidates.js';
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

// Batch the album's candidate observations so that the active-run guard is
// checked once per chunk, rather than once for every track. Each INSERT is
// atomic: stale/completed run tokens cannot write even during replacement.
export const SPOTIFY_CANDIDATE_CHUNK_SIZE = 40;

export function spotifyCandidateBatchStatement(db, message, tracks, collectedAt) {
  if (!Array.isArray(tracks) || tracks.length < 1 || tracks.length > SPOTIFY_CANDIDATE_CHUNK_SIZE) {
    throw new RangeError('Spotify candidate batch must contain 1-40 tracks');
  }
  const values = JSON.stringify(tracks.map((track) => [track.track_id, track.playcount]));
  return db.prepare(`INSERT INTO sh_spotify_playcount_candidates (
      snapshot_date,run_token,track_id,album_id,playcount,collected_at
    ) SELECT ?,?,json_extract(item.value,'$[0]'),?,json_extract(item.value,'$[1]'),?
    FROM json_each(?) AS item
    WHERE EXISTS (
      SELECT 1 FROM sh_spotify_collection_runs
      WHERE snapshot_date=? AND run_token=? AND status IN ('catalog','queued')
    )
    ORDER BY CAST(item.key AS INTEGER)
    ON CONFLICT(snapshot_date,track_id) DO UPDATE SET
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
    WHERE (sh_spotify_playcount_candidates.run_token IS NOT excluded.run_token
      OR excluded.playcount>sh_spotify_playcount_candidates.playcount
      OR (excluded.playcount=sh_spotify_playcount_candidates.playcount AND (
        sh_spotify_playcount_candidates.album_id IS NOT excluded.album_id
        OR excluded.collected_at>sh_spotify_playcount_candidates.collected_at
      )))`)
    .bind(message.snapshot_date, message.run_token, message.album_id,
      collectedAt, values, message.snapshot_date, message.run_token);
}

// Each album can contain many references to the same canonical track/artist.
// Deduplicate the pairs and issue one D1 INSERT per chunk instead of
// preparing an individual INSERT OR IGNORE for every track credit.
export function spotifyTargetBatchStatement(db, tracks) {
  const pairs = [];
  const seen = new Set();
  for (const track of tracks || []) {
    const trackId = String(track?.track_id || '').trim();
    if (!trackId) continue;
    for (const rawKey of track?.target_keys || []) {
      const artistKey = String(rawKey || '').trim();
      if (!artistKey) continue;
      const key = JSON.stringify([trackId, artistKey]);
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push([trackId, artistKey]);
    }
  }
  if (!pairs.length) return null;
  return db.prepare(`INSERT OR IGNORE INTO sh_spotify_track_targets (
      track_id,artist_key
    ) SELECT
      json_extract(item.value,'$[0]'),
      json_extract(item.value,'$[1]')
    FROM json_each(?) AS item`)
    .bind(JSON.stringify(pairs));
}

async function persistCandidateTracks(env, message, tracks, collectedAt) {
  const db = env.OTHER_DB;
  const r2Mode = spotifyR2CandidatesEnabled(env);
  const resolvedTracks = await resolveCanonicalSpotifyTracks(db, tracks, collectedAt);
  const writes = [];
  for (let index = 0; index < resolvedTracks.length; index += SPOTIFY_CANDIDATE_CHUNK_SIZE) {
    const group = resolvedTracks.slice(index, index + SPOTIFY_CANDIDATE_CHUNK_SIZE);
    // Persist new track metadata before references to these tracks.
    for (const track of group) {
      if (!track.identity_cached) {
        writes.push(
          db.prepare(`INSERT OR IGNORE INTO sh_spotify_tracks (
              track_id,album_id,name,disc_number,track_number,duration_ms,artists_json,updated_at
            ) VALUES (?,?,?,?,?,?,?,?)`)
            .bind(track.track_id, message.album_id, track.name, track.disc_number,
              track.track_number, track.duration_ms, track.artists_json, collectedAt),
        );
      }
    }
    if (!r2Mode) writes.push(spotifyCandidateBatchStatement(db, message, group, collectedAt));
    const targetInsert = spotifyTargetBatchStatement(db, group);
    if (targetInsert) writes.push(targetInsert);
  }
  await batchStatements(db, writes);
  // A receipt is durable before the album completion counter is advanced.
  // Concurrent retries never overwrite another receipt (unlike mutable R2 keys).
  if (r2Mode) await saveSpotifyR2AlbumCandidates(env, message, resolvedTracks, collectedAt);
}

function rawArtistIds(rawArtists) {
  const ids = [];
  for (const entry of rawArtists || []) {
    const artist = entry?.artist || entry;
    const directId = safeText(artist?.id);
    const uri = safeText(artist?.uri);
    const artistId = directId || (uri.startsWith('spotify:artist:') ? uri.slice('spotify:artist:'.length) : '');
    if (artistId) ids.push(artistId);
  }
  return ids;
}

export function rawTargetTrackCoverage(payload, targets) {
  const targetIds = new Set(
    (targets || []).map((target) => safeText(target?.spotify_artist_id)).filter(Boolean),
  );
  const album = payload?.data?.albumUnion || payload?.data?.album || payload;
  const rawItems = Array.isArray(album?.tracks?.items) ? album.tracks.items : [];
  const albumArtistIds = rawArtistIds(album?.artists?.items || album?.artists);
  let complete = rawItems.length > 0;
  let hasTargetCredit = false;
  let targetTracks = 0;
  let invalidTargetTracks = 0;

  for (const item of rawItems) {
    const rawTrack = item?.track || item;
    let artistIds = rawArtistIds(rawTrack?.artists?.items || rawTrack?.artists);
    if (!artistIds.length) artistIds = albumArtistIds;
    if (!artistIds.length) {
      complete = false;
      continue;
    }
    if (!artistIds.some((artistId) => targetIds.has(artistId))) continue;

    hasTargetCredit = true;
    targetTracks += 1;
    const directId = safeText(rawTrack?.id);
    const uri = safeText(rawTrack?.uri);
    const trackId = directId || (uri.startsWith('spotify:track:') ? uri.slice('spotify:track:'.length) : '');
    const playcount = integer(rawTrack?.playcount);
    if (!trackId || playcount == null || playcount < 0) invalidTargetTracks += 1;
  }

  return { complete, hasTargetCredit, targetTracks, invalidTargetTracks };
}

async function collectAlbum(env, message, session, dependencies) {
  const payload = await fetchAlbumPlaycountPayload(
    message.album_id, env, session, dependencies.fetch || fetch,
  );
  if (!(await activeRunMatches(env.OTHER_DB, message))) {
    return { trackCount: 0, stale: true, unrelated: false };
  }
  const tracks = normalizeAlbumTracks(payload, message.targets);
  const coverage = rawTargetTrackCoverage(payload, message.targets);
  if (coverage.invalidTargetTracks > 0 || coverage.targetTracks > tracks.length) {
    throw new Error(
      `Spotify album ${message.album_id} returned ${coverage.invalidTargetTracks || coverage.targetTracks - tracks.length} target tracks without usable playcounts`,
    );
  }
  if (!tracks.length) {
    if (coverage.complete && !coverage.hasTargetCredit) {
      return { trackCount: 0, stale: false, unrelated: true };
    }
    throw new Error(`Spotify album ${message.album_id} returned no target playcount tracks`);
  }
  await persistCandidateTracks(env, message, tracks, Date.now());
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

// Start from the configured artists, resolve their reverse aliases, then seek
// exact (date, source ID) rows. A date-only scan still visits unrelated artists.
export function spotifyPreviousTargetPlaycountsStatement(db, previousDate, targetKeys) {
  const keys = [...new Set((targetKeys || []).map(String).filter(Boolean))];
  if (!keys.length) throw new Error('Spotify previous-day target keys are required');
  const placeholders = keys.map(() => '?').join(',');
  return db.prepare(`WITH targets AS MATERIALIZED (
      SELECT DISTINCT track_id FROM sh_spotify_track_targets
      WHERE artist_key IN (${placeholders})
    ), sources AS MATERIALIZED (
      SELECT target.track_id,alias.source_track_id
      FROM targets AS target
      CROSS JOIN sh_spotify_track_aliases AS alias
      WHERE alias.canonical_track_id=target.track_id
      UNION ALL
      SELECT target.track_id,target.track_id AS source_track_id
      FROM targets AS target
      WHERE NOT EXISTS (
        SELECT 1 FROM sh_spotify_track_aliases AS direct
        WHERE direct.source_track_id=target.track_id
      )
    )
    SELECT source.track_id,MAX(daily.playcount) AS playcount
    FROM sources AS source
    CROSS JOIN sh_spotify_playcount_daily AS daily
    WHERE daily.snapshot_date=? AND daily.track_id=source.source_track_id
    GROUP BY source.track_id
    ORDER BY source.track_id`)
    .bind(...keys, previousDate);
}

async function finalizeAttempt(env, message) {
  const db = env.OTHER_DB;
  const r2Mode = spotifyR2CandidatesEnabled(env);
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

  let candidates;
  try {
    if (r2Mode) {
      const albumResult = await db.prepare(`SELECT album_id,track_count
        FROM sh_spotify_collection_album_runs
        WHERE snapshot_date=? AND run_token=? AND status='complete'
        ORDER BY album_id`).bind(message.snapshot_date, message.run_token).all();
      candidates = await loadSpotifyR2RunCandidates(env, message, resultsOf(albumResult));
    } else {
      const candidateResult = await db.prepare(`SELECT track_id,playcount,collected_at
        FROM sh_spotify_playcount_candidates WHERE snapshot_date=? AND run_token=? ORDER BY track_id`)
        .bind(message.snapshot_date, message.run_token).all();
      candidates = resultsOf(candidateResult);
    }
  } catch (error) {
    await failRun(db, message, error);
    return { error: true, reason: 'candidate-store-unavailable' };
  }
  if (!candidates.length) {
    await failRun(db, message, new Error('Spotify attempt collected no tracks'));
    return { error: true };
  }

  const previousDate = previousDateKey(message.snapshot_date);
  const targetKeys = SPOTIFY_TARGET_ARTISTS.map((artist) => artist.artist_key);
  const previous = resultsOf(await spotifyPreviousTargetPlaycountsStatement(
    db, previousDate, targetKeys,
  ).all());
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
    r2Mode
      ? spotifyDailyFinalizeR2Statement(db, message, previousDate, candidates)
      : spotifyDailyFinalizeStatement(db, message, previousDate),
    spotifyDailyAliasCleanupStatement(db, message.snapshot_date),
    ...spotifyArtistDailyRefreshStatements(db, message.snapshot_date, now),
    // The canonical daily table is the sole latest-value source. The former
    // sh_spotify_playcount_current copy had no production readers and doubled
    // the per-track writes at every completed snapshot.
    db.prepare(`UPDATE sh_spotify_collection_runs
      SET status='complete',tracks_collected=?,errors=0,completed_at=?,updated_at=?,last_error=NULL
      WHERE snapshot_date=? AND run_token=? AND status='finalizing'`)
      .bind(candidates.length, now, now, message.snapshot_date, message.run_token),
    ...(r2Mode ? [] : [db.prepare(`DELETE FROM sh_spotify_playcount_candidates
      WHERE snapshot_date=? AND run_token=?`)
      .bind(message.snapshot_date, message.run_token)]),
    db.prepare(`DELETE FROM sh_spotify_collection_album_runs
      WHERE snapshot_date=? AND run_token=?`)
      .bind(message.snapshot_date, message.run_token),
  ]);
  // The canonical D1 commit is complete; R2 cleanup is best effort. If
  // deletion fails, the run-token prefix isolates leftovers from future days.
  if (r2Mode) {
    await cleanupSpotifyR2RunCandidates(env, message).catch(error => {
      logEvent('spotify_candidate_r2_cleanup_failed', {
        snapshot_date: message.snapshot_date, error: truncateError(error, 200),
      });
    });
  }
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

async function completeAlbum(env, message, trackCount) {
  await updateAlbumProgress(env.OTHER_DB, message, { status: 'complete', trackCount });
  return finalizeAttempt(env, message);
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
      await completeAlbum(env, message, result.trackCount);
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