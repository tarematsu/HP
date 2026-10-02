import {
  SPOTIFY_TARGET_ARTISTS,
  jstDateKey,
  truncateError,
} from './spotify-playcount-common.js';
import {
  fetchAlbumPlaycountPayload,
  fetchAnonymousSession,
  normalizeAlbumTracks,
} from './spotify-playcount-source.js';

const PROBE_TRACK_LIMIT = 6;

function resultsOf(result) {
  return Array.isArray(result?.results) ? result.results : [];
}

async function readOldestStaleRun(db, today) {
  return db.prepare(`SELECT snapshot_date,run_token
    FROM sh_spotify_collection_runs
    WHERE snapshot_date < ? AND status='stale'
    ORDER BY snapshot_date LIMIT 1`).bind(today).first();
}

async function readProbeTracks(db, snapshotDate, runToken) {
  const result = await db.prepare(`SELECT c.track_id,c.playcount,t.album_id
    FROM sh_spotify_playcount_candidates c
    INNER JOIN sh_spotify_tracks t ON t.track_id=c.track_id
    WHERE c.snapshot_date=? AND c.run_token=? AND t.album_id IS NOT NULL
    ORDER BY c.playcount DESC,c.track_id
    LIMIT ?`).bind(snapshotDate, runToken, PROBE_TRACK_LIMIT).all();
  return resultsOf(result).map((row) => ({
    track_id: String(row.track_id || ''),
    album_id: String(row.album_id || ''),
    playcount: Number(row.playcount),
  })).filter((row) => row.track_id && row.album_id && Number.isFinite(row.playcount));
}

export async function probeStaleSpotifyUpdate(env, scheduledTime, dependencies = {}) {
  const db = env?.OTHER_DB;
  if (!db?.prepare) return { stale: false, changed: false, reason: 'db-unavailable' };

  const today = jstDateKey(scheduledTime);
  const staleRun = await readOldestStaleRun(db, today);
  if (!staleRun?.snapshot_date || !staleRun?.run_token) {
    return { stale: false, changed: false, reason: 'no-stale-day' };
  }

  const snapshotDate = String(staleRun.snapshot_date);
  const runToken = String(staleRun.run_token);
  const probeTracks = await readProbeTracks(db, snapshotDate, runToken);
  if (!probeTracks.length) {
    return {
      stale: true,
      changed: false,
      available: false,
      reason: 'no-probe-tracks',
      snapshot_date: snapshotDate,
    };
  }

  const getSession = dependencies.fetchAnonymousSession || fetchAnonymousSession;
  const getAlbum = dependencies.fetchAlbumPlaycountPayload || fetchAlbumPlaycountPayload;
  const normalize = dependencies.normalizeAlbumTracks || normalizeAlbumTracks;
  const fetchImpl = dependencies.fetchImpl || fetch;

  try {
    const session = await getSession(env, fetchImpl);
    const rowsByAlbum = new Map();
    for (const row of probeTracks) {
      if (!rowsByAlbum.has(row.album_id)) rowsByAlbum.set(row.album_id, []);
      rowsByAlbum.get(row.album_id).push(row);
    }

    let checkedTracks = 0;
    for (const [albumId, rows] of rowsByAlbum) {
      const payload = await getAlbum(albumId, env, session, fetchImpl);
      const currentByTrack = new Map(
        normalize(payload, SPOTIFY_TARGET_ARTISTS).map((track) => [String(track.track_id), Number(track.playcount)]),
      );
      for (const row of rows) {
        const current = currentByTrack.get(row.track_id);
        if (!Number.isFinite(current)) continue;
        checkedTracks += 1;
        if (current !== row.playcount) {
          return {
            stale: true,
            changed: true,
            available: true,
            reason: 'source-changed',
            snapshot_date: snapshotDate,
            track_id: row.track_id,
            previous_playcount: row.playcount,
            current_playcount: current,
            checked_tracks: checkedTracks,
          };
        }
      }
    }

    return {
      stale: true,
      changed: false,
      available: checkedTracks > 0,
      reason: checkedTracks > 0 ? 'source-unchanged' : 'probe-track-missing-from-source',
      snapshot_date: snapshotDate,
      checked_tracks: checkedTracks,
    };
  } catch (error) {
    return {
      stale: true,
      changed: false,
      available: false,
      reason: 'source-probe-error',
      snapshot_date: snapshotDate,
      error: truncateError(error, 400),
    };
  }
}
