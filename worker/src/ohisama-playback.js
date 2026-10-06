import { extractQueue } from './collector-payload.js';
import { materializeCurrentPlaybackWindow } from './queue-materialization.js';
import { saveTrackHistoryDayReadModel } from './pages-track-history-r2-shards.js';
import {
  emptyPlaybackDaily,
  playbackDailyPublic,
  recordPlaybackDailyTrack,
  stationheadPlaybackPeriodKey,
  stationheadPlaybackTrackKey,
  transitionedStationheadTracks,
} from './stationhead-playback-core.js';
import { canonicalizeStationheadPlayback } from './stationhead-playback-identity.js';
import {
  loadStationheadPlaybackState,
  runStationheadPlaybackStatements,
  saveStationheadPlaybackState,
  stationheadCompletedDailyStatement,
  stationheadPlaybackPlayStatement,
} from './stationhead-playback-store.js';
export const OHISAMA_PLAYBACK_HOT_STATE_KEY = 'stationhead/ohisama/playback-state.json';

function finite(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function integer(value) {
  const parsed = finite(value);
  return parsed == null ? null : Math.trunc(parsed);
}

function text(value, limit = 500) {
  const parsed = String(value ?? '').trim();
  return parsed ? parsed.slice(0, limit) : null;
}

function periodKey(timestamp) {
  return stationheadPlaybackPeriodKey(timestamp);
}

function trackKey(track) {
  return stationheadPlaybackTrackKey(track);
}

function publicTrack(track, eventKey, expectedStartAt, current = false) {
  const spotifyId = text(track?.spotify_id);
  return {
    event_key: eventKey,
    track_key: trackKey(track),
    position: integer(track?.position),
    queue_track_id: integer(track?.queue_track_id),
    stationhead_track_id: integer(track?.stationhead_track_id),
    spotify_id: spotifyId,
    isrc: text(track?.isrc)?.toUpperCase() || null,
    title: text(track?.title || track?.display_title),
    artist: text(track?.artist),
    thumbnail_url: text(track?.thumbnail_url, 2_048),
    duration_ms: Math.max(0, integer(track?.duration_ms) || 0),
    bite_count: integer(track?.bite_count),
    expected_start_at: integer(expectedStartAt),
    ...(spotifyId ? { spotify_url: `https://open.spotify.com/track/${spotifyId}` } : {}),
    ...(current ? { is_current: true } : {}),
  };
}

export function resolveOhisamaPlaybackWindow(channel, stationId, observedAt) {
  const sourceQueue = extractQueue(channel, stationId);
  const tracks = Array.isArray(sourceQueue?.tracks) ? sourceQueue.tracks : [];
  if (!sourceQueue || !tracks.length) {
    return {
      queue: [],
      queue_status: null,
      queue_revision: '',
    };
  }

  const queue = materializeCurrentPlaybackWindow(sourceQueue, observedAt, 6);
  const sourceStart = integer(queue?.source_start_time ?? sourceQueue.start_time);
  const paused = Boolean(queue?.is_paused);
  const visible = (Array.isArray(queue?.tracks) ? queue.tracks : []).map((track, offset) => {
    const position = integer(track?.position) ?? offset;
    const identity = trackKey(track) || `position:${position}`;
    const eventKey = [
      queue.queue_id ?? '',
      sourceStart ?? '',
      position,
      track.queue_track_id ?? '',
      identity,
    ].join(':');
    return publicTrack(track, eventKey, track?.expected_start_at, offset === 0);
  });
  const current = visible[0] || null;
  const duration = Math.max(0, integer(current?.duration_ms) || 0);
  const currentStart = integer(current?.expected_start_at);
  const progressMs = currentStart == null
    ? 0
    : Math.max(0, duration ? Math.min(duration, observedAt - currentStart) : 0);
  const remainingTotal = Math.max(0, integer(queue?.total_track_count) || visible.length);
  const currentPosition = integer(current?.position) ?? 0;

  return {
    queue: visible,
    queue_status: {
      is_paused: paused,
      playing: visible.length > 0 && !paused,
      current_index: visible.length ? 0 : -1,
      progress_ms: progressMs,
      anchor_at: currentStart ?? observedAt - progressMs,
      total_items: remainingTotal,
      returned_items: visible.length,
      loaded_items: visible.length,
      has_more: remainingTotal > visible.length,
    },
    queue_revision: `${queue.queue_id ?? ''}:${sourceStart ?? ''}:${currentPosition}:${visible.length}`,
  };
}

export function transitionedOhisamaTracks(previousQueue = [], currentQueue = [], options = {}) {
  return transitionedStationheadTracks(previousQueue, currentQueue, options);
}

function likeStatements(db, stationId, track, observedAt) {
  const count = integer(track?.bite_count);
  const trackId = integer(track?.track_id);
  if (trackId == null || count == null) return [];
  const current = db.prepare(`INSERT OR REPLACE INTO sh_track_like_current(
      station_id,track_id,track_key,spotify_id,isrc,title,artist,like_count,observed_at
    ) VALUES(?,?,?,?,?,?,?,?,?)`)
    .bind(stationId, trackId, track.track_key, track.spotify_id || null, track.isrc || null,
      track.title || null, track.artist || null, count, observedAt);
  const observation = db.prepare(`INSERT OR REPLACE INTO sh_track_like_observations(
      station_id,track_id,track_key,spotify_id,isrc,title,artist,like_count,observed_at
    ) VALUES(?,?,?,?,?,?,?,?,?)`)
    .bind(stationId, trackId, track.track_key, track.spotify_id || null, track.isrc || null,
      track.title || null, track.artist || null, count, observedAt);
  return [current, observation];
}

function trackHistoryDayRange(period) {
  const fromTs = Date.parse(`${String(period || '')}T00:00:00Z`);
  if (!Number.isFinite(fromTs)) throw new Error(`invalid Ohisama playback day: ${period}`);
  return { fromTs, toTs: fromTs + 24 * 60 * 60_000 };
}

function trackHistoryRows(daily) {
  const row = Array.isArray(daily?.tracks) ? daily : playbackDailyPublic(daily);
  return (Array.isArray(row?.tracks) ? row.tracks : []).map((track) => ({
    play_date: row.period_key,
    track_id: integer(track?.track_id),
    spotify_id: text(track?.spotify_id),
    title: text(track?.title),
    artist: text(track?.artist),
    play_count: Math.max(0, integer(track?.count) || 0),
  })).filter((track) => track.track_id != null && track.play_count > 0);
}

async function publishOhisamaTrackHistoryDay(bucket, daily, observedAt) {
  const row = Array.isArray(daily?.tracks) ? daily : playbackDailyPublic(daily);
  if (!row?.period_key) return null;
  return saveTrackHistoryDayReadModel(
    bucket,
    trackHistoryDayRange(row.period_key),
    trackHistoryRows(row),
    {
      source: 'ohisama',
      updated_at: observedAt,
      source_row_count: Math.max(0, integer(row.total_plays) || 0),
    },
  );
}

export async function captureOhisamaPlayback(env, channel, collection, observedAt = Date.now()) {
  const db = env?.OHISAMA_DB;
  const catalogDb = env?.MINUTE_DB;
  const bucket = env?.PAGES_RESPONSE_R2;
  if (!db?.prepare) throw new Error('OHISAMA_DB binding is missing');
  if (!catalogDb?.prepare) throw new Error('MINUTE_DB binding is missing');

  const stationId = integer(collection?.station_id);
  const playback = resolveOhisamaPlaybackWindow(channel, stationId, observedAt);
  const previous = (await loadStationheadPlaybackState(bucket, OHISAMA_PLAYBACK_HOT_STATE_KEY)).state;
  const canonicalState = await canonicalizeStationheadPlayback(
    catalogDb,
    null,
    playback.queue,
    previous,
    observedAt,
    { channelId: 'ohisama' },
  );
  playback.queue = canonicalState.tracks;
  const previousDaily = canonicalState.daily?.period_key
    ? canonicalState.daily
    : emptyPlaybackDaily(periodKey(observedAt));
  let daily = previousDaily;
  let completedDay = null;
  const statements = [];
  const transitions = transitionedOhisamaTracks(previous?.queue, playback.queue, {
    previousObservedAt: previous?.updated_at,
    observedAt,
    previousPaused: Boolean(previous?.queue_status?.is_paused),
    currentPaused: Boolean(playback?.queue_status?.is_paused),
  });

  for (const track of transitions) {
    const playedAt = integer(track?.expected_start_at) ?? observedAt;
    const nextKey = periodKey(playedAt);
    if (daily?.period_key && daily.period_key !== nextKey) {
      completedDay = playbackDailyPublic(daily);
      statements.push(stationheadCompletedDailyStatement(db, daily, observedAt));
      daily = emptyPlaybackDaily(nextKey);
    }
    daily = recordPlaybackDailyTrack(daily, track, playedAt);
    statements.push(stationheadPlaybackPlayStatement(db, stationId, track, observedAt, 'Ohisama'));
  }

  if (!daily?.period_key) daily = emptyPlaybackDaily(periodKey(observedAt));
  if (daily.period_key !== periodKey(observedAt) && !transitions.length) {
    completedDay = playbackDailyPublic(daily);
    statements.push(stationheadCompletedDailyStatement(db, daily, observedAt));
    daily = emptyPlaybackDaily(periodKey(observedAt));
  }

  const likes = canonicalState.likes;
  for (const track of playback.queue) {
    const trackId = integer(track?.track_id);
    if (trackId == null || integer(track?.bite_count) == null) continue;
    const key = String(trackId);
    const previousLike = likes[key];
    if (integer(previousLike?.like_count) === integer(track.bite_count)) continue;
    likes[key] = {
      track_id: trackId,
      track_key: track.track_key || previousLike?.track_key || null,
      spotify_id: track.spotify_id || previousLike?.spotify_id || null,
      isrc: track.isrc || previousLike?.isrc || null,
      title: track.title || previousLike?.title || null,
      artist: track.artist || previousLike?.artist || null,
      like_count: integer(track.bite_count),
      observed_at: observedAt,
    };
    statements.push(...likeStatements(db, stationId, track, observedAt));
  }

  await runStationheadPlaybackStatements(db, statements);
  if (completedDay?.period_key) {
    await publishOhisamaTrackHistoryDay(bucket, completedDay, observedAt);
  }
  if (transitions.length || completedDay) {
    await publishOhisamaTrackHistoryDay(bucket, playbackDailyPublic(daily), observedAt);
  }
  const state = {
    version: 2,
    updated_at: observedAt,
    station_id: stationId,
    queue: playback.queue,
    queue_status: playback.queue_status,
    queue_revision: playback.queue_revision,
    daily,
    likes,
  };
  await saveStationheadPlaybackState(bucket, OHISAMA_PLAYBACK_HOT_STATE_KEY, state, observedAt);

  return {
    ...playback,
    daily: playbackDailyPublic(daily),
    completed_day: completedDay,
    likes: Object.values(likes)
      .sort((left, right) => (integer(right.like_count) || 0) - (integer(left.like_count) || 0)),
    transitions_written: transitions.length,
    like_changes_written: statements.length - transitions.length - (completedDay ? 1 : 0),
  };
}

