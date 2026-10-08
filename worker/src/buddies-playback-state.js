import { requireStationheadSourceProfile } from '../../packages/sh-shared/stationhead-source.mjs';
import {
  playbackDailyPublic,
  stationheadPlaybackPeriodKey as buddiesPlaybackPeriodKey,
  stationheadPlaybackTrackKey as buddiesTrackKey,
  transitionedStationheadTracks as transitionedBuddiesTracks,
  stationheadPlaybackInteger as integer,
  stationheadPlaybackText as text,
} from './stationhead-playback-core.js';
import { canonicalizeStationheadPlayback } from './stationhead-playback-identity.js';
import {
  loadStationheadPlaybackState,
  planStationheadPlaybackDaily,
  runStationheadPlaybackStatements,
  saveStationheadPlaybackState,
} from './stationhead-playback-store.js';

export const BUDDIES_PLAYBACK_HOT_STATE_KEY = requireStationheadSourceProfile('buddies').playbackHotKey;

export { buddiesPlaybackPeriodKey, buddiesTrackKey, transitionedBuddiesTracks };

function playbackTrack(queue, track, fallbackIndex) {
  const trackKey = buddiesTrackKey(track);
  const position = integer(track?.position) ?? fallbackIndex;
  const sourceStart = integer(queue?.source_start_time ?? queue?.start_time);
  const queueId = integer(queue?.queue_id);
  const queueTrackId = integer(track?.queue_track_id);
  const eventKey = [
    queueId ?? '',
    sourceStart ?? '',
    position,
    queueTrackId ?? '',
    trackKey || '',
  ].join(':');
  return {
    ...track,
    track_id: integer(track?.track_id ?? track?.trackId),
    position,
    track_key: trackKey,
    event_key: eventKey,
    expected_start_at: integer(track?.expected_start_at),
  };
}

function normalizedQueue(queue) {
  const tracks = (Array.isArray(queue?.tracks) ? queue.tracks : [])
    .slice(0, 6)
    .map((track, index) => playbackTrack(queue, track, index));
  return {
    station_id: integer(queue?.station_id),
    queue_id: integer(queue?.queue_id),
    start_time: integer(queue?.start_time),
    source_start_time: integer(queue?.source_start_time ?? queue?.start_time),
    is_paused: Boolean(queue?.is_paused),
    total_track_count: integer(queue?.total_track_count) ?? tracks.length,
    tracks,
  };
}

function likeStatements(db, queue, track, observedAt) {
  const count = integer(track?.bite_count);
  const trackId = integer(track?.track_id);
  if (!track?.track_key || trackId == null || count == null) return [];
  const stationId = integer(queue?.station_id);
  const queueId = integer(queue?.queue_id);
  const sourceStart = integer(queue?.source_start_time ?? queue?.start_time);
  const position = integer(track?.position);
  const queueTrackId = integer(track?.queue_track_id);
  const stationheadTrackId = integer(track?.stationhead_track_id);
  const spotifyId = text(track?.spotify_id);
  const isrc = text(track?.isrc)?.toUpperCase() || null;
  const current = db.prepare(`INSERT INTO sh_track_like_current(
      station_id,track_key,queue_id,start_time,position,queue_track_id,
      stationhead_track_id,spotify_id,isrc,like_count,observed_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(station_id,track_key) DO UPDATE SET
      queue_id=excluded.queue_id,start_time=excluded.start_time,position=excluded.position,
      queue_track_id=excluded.queue_track_id,stationhead_track_id=excluded.stationhead_track_id,
      spotify_id=excluded.spotify_id,isrc=excluded.isrc,
      like_count=excluded.like_count,observed_at=excluded.observed_at
    WHERE excluded.observed_at>=sh_track_like_current.observed_at
      AND excluded.like_count IS NOT sh_track_like_current.like_count`)
    .bind(
      stationId, track.track_key, queueId, sourceStart, position, queueTrackId,
      stationheadTrackId, spotifyId, isrc, count, observedAt,
    );
  const observation = db.prepare(`INSERT OR IGNORE INTO sh_track_like_observations(
      observed_at,station_id,queue_id,start_time,position,queue_track_id,
      stationhead_track_id,spotify_id,isrc,track_key,like_count,source,raw_json
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(
      observedAt, stationId, queueId, sourceStart, position, queueTrackId,
      stationheadTrackId, spotifyId, isrc, track.track_key, count,
      'r2-playback',
      JSON.stringify({
        track_id: trackId,
        title: text(track?.title),
        artist: text(track?.artist),
        thumbnail_url: text(track?.thumbnail_url, 2_048),
      }),
    );
  return [current, observation];
}

export async function captureBuddiesPlayback(env, queue, observedAt = Date.now()) {
  const db = env?.DB || env?.BUDDIES_DB;
  const catalogDb = env?.MINUTE_DB;
  const bucket = env?.PAGES_RESPONSE_R2;
  if (!db?.prepare) throw new Error('Buddies D1 binding is missing');
  const currentQueue = normalizedQueue(queue);
  const loaded = await loadStationheadPlaybackState(bucket, BUDDIES_PLAYBACK_HOT_STATE_KEY);
  if (!loaded.available) {
    return {
      queue: currentQueue,
      transitions_written: 0,
      like_changes_written: 0,
      d1_rows_written: 0,
      state_saved: false,
      skipped: true,
      reason: 'playback-r2-unavailable',
    };
  }

  const previous = loaded.state;
  const canonical = await canonicalizeStationheadPlayback(
    catalogDb,
    db,
    currentQueue.tracks,
    previous,
    observedAt,
    { channelId: 'buddies' },
  );
  currentQueue.tracks = canonical.tracks;
  const transitions = transitionedBuddiesTracks(previous?.queue, currentQueue.tracks, {
    previousObservedAt: previous?.updated_at,
    observedAt,
    previousPaused: Boolean(previous?.queue_status?.is_paused),
    currentPaused: currentQueue.is_paused,
  });

  const { daily, completedDay, statements } = planStationheadPlaybackDaily(
    db, currentQueue.station_id, canonical.daily, transitions, observedAt, 'Buddies',
  );

  const likes = { ...(canonical.likes || {}) };
  let likeChanges = 0;
  for (const track of currentQueue.tracks) {
    const trackId = integer(track?.track_id);
    if (trackId == null || integer(track?.bite_count) == null) continue;
    const likeKey = String(trackId);
    const previousLike = likes[likeKey];
    if (integer(previousLike?.like_count) === integer(track.bite_count)) continue;
    likeChanges += 1;
    likes[likeKey] = {
      track_id: trackId,
      track_key: track.track_key,
      spotify_id: text(track.spotify_id) || previousLike?.spotify_id || null,
      isrc: text(track.isrc)?.toUpperCase() || previousLike?.isrc || null,
      title: text(track.title) || previousLike?.title || null,
      artist: text(track.artist) || previousLike?.artist || null,
      like_count: integer(track.bite_count),
      observed_at: observedAt,
    };
    statements.push(...likeStatements(db, currentQueue, track, observedAt));
  }

  await runStationheadPlaybackStatements(db, statements);
  const state = {
    version: 2,
    updated_at: observedAt,
    station_id: currentQueue.station_id,
    queue: currentQueue.tracks,
    queue_status: { is_paused: currentQueue.is_paused },
    daily,
    likes,
  };
  const stateSaved = await saveStationheadPlaybackState(bucket, BUDDIES_PLAYBACK_HOT_STATE_KEY, state, observedAt);
  return {
    queue: currentQueue,
    daily: playbackDailyPublic(daily),
    completed_day: completedDay,
    transitions_written: transitions.length,
    like_changes_written: likeChanges,
    d1_rows_written: transitions.length + likeChanges * 2 + (completedDay ? 1 : 0),
    state_saved: stateSaved,
    skipped: false,
  };
}