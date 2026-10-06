import { hydratePlaybackAggregates, hydratePlaybackTrackMetadata } from './playback-track-metadata.js';
import { extractQueue } from './collector-payload.js';
import { resolveTracksBulk } from './minute-facts-track-resolution.js';
import { pagesR2ResponseKey } from './pages-response-r2.js';
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
export const OHISAMA_PLAYBACK_HOT_STATE_KEY = 'stationhead/ohisama/playback-state.json';
const OHISAMA_PAGES_KEY = pagesR2ResponseKey('hinata');

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

async function loadState(bucket) {
  if (typeof bucket?.get !== 'function') return null;
  try {
    const object = await bucket.get(OHISAMA_PLAYBACK_HOT_STATE_KEY);
    if (!object) return null;
    const value = typeof object.json === 'function' ? await object.json() : JSON.parse(await object.text());
    return [1, 2].includes(Number(value?.version)) ? value : null;
  } catch {
    return null;
  }
}

async function saveState(bucket, state, observedAt) {
  if (typeof bucket?.put !== 'function') return false;
  await bucket.put(OHISAMA_PLAYBACK_HOT_STATE_KEY, JSON.stringify(state), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
    customMetadata: { version: '2', updated_at: String(observedAt) },
  });
  return true;
}

function normalizedIdentitySource(track = {}) {
  const key = text(track?.track_key);
  return {
    ...track,
    track_key: key || trackKey(track),
    isrc: text(track?.isrc)?.toUpperCase()
      || (key?.startsWith('isrc:') ? key.slice('isrc:'.length).toUpperCase() : null),
    spotify_id: text(track?.spotify_id)
      || (key?.startsWith('spotify:') ? key.slice('spotify:'.length) : null),
    stationhead_track_id: integer(track?.stationhead_track_id)
      ?? (key?.startsWith('stationhead:') ? integer(key.slice('stationhead:'.length)) : null),
  };
}

function collectIdentitySources(playback, previous) {
  return [
    ...(playback?.queue || []),
    ...(previous?.queue || []),
    ...Object.values(previous?.daily?.tracks || {}),
    ...Object.values(previous?.likes || {}),
  ].map(normalizedIdentitySource);
}

function canonicalIdMaps(sources) {
  const byKey = new Map();
  for (const source of sources) {
    const trackId = integer(source?.track_id);
    const key = text(source?.track_key) || trackKey(source);
    if (trackId != null && key) byKey.set(key, trackId);
  }
  return { byKey };
}

function withCanonicalTrackId(track, byKey) {
  const normalized = normalizedIdentitySource(track);
  const currentId = integer(normalized.track_id);
  if (currentId != null) return { ...normalized, track_id: currentId };
  const resolved = byKey.get(normalized.track_key);
  return resolved == null ? normalized : { ...normalized, track_id: resolved };
}

function canonicalizeDaily(daily, byKey) {
  if (!daily?.period_key) return emptyPlaybackDaily('');
  const tracks = {};
  const unique = new Set();
  let totalPlays = 0;
  for (const source of Object.values(daily.tracks || {})) {
    const track = withCanonicalTrackId(source, byKey);
    const trackId = integer(track.track_id);
    const count = Math.max(0, integer(source?.count) || 0);
    if (trackId == null || count === 0) continue;
    const key = String(trackId);
    const previous = tracks[key] || {};
    tracks[key] = {
      track_id: trackId,
      track_key: track.track_key || previous.track_key || null,
      title: track.title || previous.title || null,
      artist: track.artist || previous.artist || null,
      spotify_id: track.spotify_id || previous.spotify_id || null,
      count: (integer(previous.count) || 0) + count,
    };
    unique.add(key);
    totalPlays += count;
  }
  return {
    period_key: String(daily.period_key),
    total_plays: totalPlays,
    unique_track_ids: [...unique],
    tracks,
  };
}

function canonicalizeLikes(likes, byKey) {
  const result = {};
  for (const source of Object.values(likes || {})) {
    const track = withCanonicalTrackId(source, byKey);
    const trackId = integer(track.track_id);
    if (trackId == null) continue;
    const key = String(trackId);
    const existing = result[key];
    if (existing && (integer(existing.observed_at) || 0) > (integer(track.observed_at) || 0)) continue;
    result[key] = { ...track, track_id: trackId };
  }
  return result;
}

async function applyCanonicalTrackIds(catalogDb, playback, previous, observedAt) {
  if (!catalogDb?.prepare) throw new Error('MINUTE_DB binding is missing');
  const sources = collectIdentitySources(playback, previous);
  const { byKey } = canonicalIdMaps(sources);
  const unresolvedByKey = new Map();
  for (const source of sources) {
    const key = text(source?.track_key) || trackKey(source);
    if (!key || byKey.has(key)) continue;
    if (!unresolvedByKey.has(key)) unresolvedByKey.set(key, source);
  }
  const unresolved = [...unresolvedByKey.values()];
  if (unresolved.length) {
    const resolved = await resolveTracksBulk(catalogDb, null, unresolved, observedAt, {
      channelId: 'ohisama',
      minuteAt: Math.floor(observedAt / 60_000) * 60_000,
      queueTracks: playback?.queue?.length || 0,
      revisionId: null,
    });
    for (const descriptor of resolved) {
      const trackId = integer(descriptor?.trackId);
      const key = text(descriptor?.track_key) || trackKey(descriptor);
      if (trackId != null && key) byKey.set(key, trackId);
    }
  }
  playback.queue = await hydratePlaybackTrackMetadata(
    catalogDb,
    (playback.queue || []).map((track) => withCanonicalTrackId(track, byKey)),
    previous?.queue || [],
  );
  return hydratePlaybackAggregates(catalogDb,
    canonicalizeDaily(previous?.daily, byKey),
    canonicalizeLikes(previous?.likes, byKey), playback.queue);
}

function playStatement(db, stationId, track, observedAt) {
  const playedAt = integer(track?.expected_start_at) ?? observedAt;
  const trackId = integer(track?.track_id);
  if (trackId == null) throw new Error('Ohisama playback track_id is unresolved');
  return db.prepare(`INSERT OR IGNORE INTO sh_track_plays(
      event_key,played_at,period_key,station_id,track_id,track_key
    ) VALUES(?,?,?,?,?,?)`)
    .bind(
      track.event_key,
      playedAt,
      periodKey(playedAt),
      stationId,
      trackId,
      track.track_key,
    );
}

function completedDailyStatement(db, daily, observedAt) {
  const row = playbackDailyPublic(daily);
  return db.prepare(`INSERT INTO sh_track_daily_summary(
      period_key,total_plays,unique_tracks,tracks_json,updated_at
    ) VALUES(?,?,?,?,?)
    ON CONFLICT(period_key) DO UPDATE SET
      total_plays=excluded.total_plays,
      unique_tracks=excluded.unique_tracks,
      tracks_json=excluded.tracks_json,
      updated_at=excluded.updated_at
    WHERE excluded.updated_at>=sh_track_daily_summary.updated_at`)
    .bind(row.period_key, row.total_plays, row.unique_tracks, JSON.stringify(row.tracks), observedAt);
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

async function runStatements(db, statements) {
  if (!statements.length) return;
  if (typeof db?.batch === 'function') {
    await db.batch(statements);
    return;
  }
  for (const statement of statements) await statement.run();
}

function trackHistoryDayRange(period) {
  const fromTs = Date.parse(`${String(period || '')}T00:00:00Z`);
  if (!Number.isFinite(fromTs)) throw new Error(`invalid Ohisama playback day: ${period}`);
  return { fromTs, toTs: fromTs + 24 * 60 * 60_000 };
}

function trackHistoryRows(daily) {
  const row = daily?.tracks ? daily : playbackDailyPublic(daily);
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
  const row = daily?.tracks ? daily : playbackDailyPublic(daily);
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
  const previous = await loadState(bucket);
  const canonicalState = await applyCanonicalTrackIds(catalogDb, playback, previous, observedAt);
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
      statements.push(completedDailyStatement(db, daily, observedAt));
      daily = emptyPlaybackDaily(nextKey);
    }
    daily = recordPlaybackDailyTrack(daily, track, playedAt);
    statements.push(playStatement(db, stationId, track, observedAt));
  }

  if (!daily?.period_key) daily = emptyPlaybackDaily(periodKey(observedAt));
  if (daily.period_key !== periodKey(observedAt) && !transitions.length) {
    completedDay = playbackDailyPublic(daily);
    statements.push(completedDailyStatement(db, daily, observedAt));
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

  await runStatements(db, statements);
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
  await saveState(bucket, state, observedAt).catch(() => false);

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

function mergePlayedHistory(existing, current, completed) {
  const byKey = new Map();
  for (const row of Array.isArray(existing) ? existing : []) {
    if (row?.period_key) byKey.set(String(row.period_key), row);
  }
  if (completed?.period_key) byKey.set(String(completed.period_key), completed);
  if (current?.period_key) byKey.set(String(current.period_key), current);
  return [...byKey.values()]
    .sort((left, right) => String(right.period_key || '').localeCompare(String(left.period_key || '')))
    .slice(0, 90);
}

export async function mergeOhisamaPlaybackReadModel(env, playback, collection, observedAt = Date.now()) {
  const bucket = env?.PAGES_RESPONSE_R2;
  if (!OHISAMA_PAGES_KEY || typeof bucket?.get !== 'function' || typeof bucket?.put !== 'function') return false;
  const object = await bucket.get(OHISAMA_PAGES_KEY);
  if (!object) return false;
  const envelope = await object.json();
  if (Number(envelope?.version) !== 1) return false;
  const payload = typeof envelope.body === 'string' ? JSON.parse(envelope.body) : envelope.body;
  if (!payload || payload.model !== 'hinata') return false;

  const next = {
    ...payload,
    updated_at: observedAt,
    latest: {
      ...(payload.latest || {}),
      host_handle: collection?.host_handle || payload.latest?.host_handle || null,
    },
    queue: playback?.queue || [],
    queue_status: playback?.queue_status || null,
    queue_revision: playback?.queue_revision || '',
    played_tracks: playback?.daily || null,
    played_history: mergePlayedHistory(payload.played_history, playback?.daily, playback?.completed_day),
    likes: Array.isArray(playback?.likes) ? playback.likes : [],
  };
  const nextEnvelope = {
    ...envelope,
    updated_at: observedAt,
    body: JSON.stringify(next),
  };
  await bucket.put(OHISAMA_PAGES_KEY, JSON.stringify(nextEnvelope), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
    customMetadata: {
      version: '1',
      model_key: 'hinata',
      updated_at: String(observedAt),
      cadence_seconds: '300',
    },
  });
  return true;
}