import { resolveTracksBulk } from './minute-facts-track-resolution.js';

const DAY_MS = 24 * 60 * 60_000;

export const BUDDIES_PLAYBACK_HOT_STATE_KEY = 'stationhead/buddies/playback-state.json';

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

export function buddiesPlaybackPeriodKey(timestamp) {
  return new Date(Math.floor(Number(timestamp) / DAY_MS) * DAY_MS).toISOString().slice(0, 10);
}

export function buddiesTrackKey(track) {
  const isrc = text(track?.isrc)?.toUpperCase();
  if (isrc) return `isrc:${isrc}`;
  const spotifyId = text(track?.spotify_id);
  if (spotifyId) return `spotify:${spotifyId}`;
  const stationheadId = integer(track?.stationhead_track_id);
  if (stationheadId != null) return `stationhead:${stationheadId}`;
  const title = text(track?.title || track?.display_title);
  const artist = text(track?.artist);
  return title ? `title:${title}\u0000${artist || ''}` : null;
}

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

export function transitionedBuddiesTracks(previousQueue = [], currentQueue = []) {
  const current = currentQueue[0] || null;
  if (!current?.event_key) return [];
  const previous = Array.isArray(previousQueue) ? previousQueue : [];
  if (!previous.length) return [current];
  if (previous[0]?.event_key === current.event_key) return [];
  const index = previous.findIndex((track) => track?.event_key === current.event_key);
  if (index > 0) return previous.slice(1, index + 1);
  return [current];
}

function emptyDaily(periodKey) {
  return {
    period_key: periodKey,
    total_plays: 0,
    unique_track_ids: [],
    tracks: {},
  };
}

function dailyPublic(daily) {
  const tracks = Object.values(daily?.tracks || {})
    .map((entry) => ({
      ...entry,
      track_id: integer(entry?.track_id),
      count: integer(entry?.count) || 0,
    }))
    .filter((entry) => entry.track_id != null)
    .sort((left, right) => right.count - left.count
      || String(left.title || '').localeCompare(String(right.title || ''), 'ja'));
  return {
    period_key: String(daily?.period_key || ''),
    total_plays: integer(daily?.total_plays) || tracks.reduce((sum, entry) => sum + entry.count, 0),
    unique_tracks: Array.isArray(daily?.unique_track_ids) ? daily.unique_track_ids.length : tracks.length,
    tracks,
  };
}

function recordDailyTrack(daily, track, playedAt) {
  const trackId = integer(track?.track_id);
  if (trackId == null) return daily;
  const key = String(trackId);
  const periodKey = buddiesPlaybackPeriodKey(playedAt);
  const active = daily?.period_key === periodKey ? daily : emptyDaily(periodKey);
  const unique = new Set(Array.isArray(active.unique_track_ids)
    ? active.unique_track_ids.map(String)
    : []);
  unique.add(key);
  const tracks = { ...(active.tracks || {}) };
  const previous = tracks[key] || {};
  tracks[key] = {
    track_id: trackId,
    track_key: track?.track_key || previous.track_key || null,
    title: track?.title || previous.title || null,
    artist: track?.artist || previous.artist || null,
    spotify_id: track?.spotify_id || previous.spotify_id || null,
    count: (integer(previous.count) || 0) + 1,
  };
  return {
    period_key: periodKey,
    total_plays: (integer(active.total_plays) || 0) + 1,
    unique_track_ids: [...unique],
    tracks,
  };
}

function normalizedIdentitySource(track = {}) {
  const key = text(track?.track_key) || buddiesTrackKey(track);
  return {
    ...track,
    track_id: integer(track?.track_id ?? track?.trackId),
    track_key: key,
    isrc: text(track?.isrc)?.toUpperCase()
      || (key?.startsWith('isrc:') ? key.slice('isrc:'.length).toUpperCase() : null),
    spotify_id: text(track?.spotify_id)
      || (key?.startsWith('spotify:') ? key.slice('spotify:'.length) : null),
    stationhead_track_id: integer(track?.stationhead_track_id)
      ?? (key?.startsWith('stationhead:') ? integer(key.slice('stationhead:'.length)) : null),
  };
}

function collectIdentitySources(queue, previous) {
  return [
    ...(queue?.tracks || []),
    ...(previous?.queue || []),
    ...Object.values(previous?.daily?.tracks || {}),
    ...Object.values(previous?.likes || {}),
  ].map(normalizedIdentitySource);
}

function canonicalIdMap(sources) {
  const byKey = new Map();
  for (const source of sources) {
    const trackId = integer(source?.track_id);
    const key = text(source?.track_key) || buddiesTrackKey(source);
    if (trackId != null && key) byKey.set(key, trackId);
  }
  return byKey;
}

function withCanonicalTrackId(track, byKey) {
  const normalized = normalizedIdentitySource(track);
  const direct = integer(normalized.track_id);
  if (direct != null) return { ...normalized, track_id: direct };
  const resolved = byKey.get(normalized.track_key);
  return resolved == null ? normalized : { ...normalized, track_id: resolved };
}

function canonicalizeDaily(daily, byKey) {
  if (!daily?.period_key) return emptyDaily('');
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

async function applyCanonicalTrackIds(catalogDb, metadataDb, queue, previous, observedAt) {
  if (!catalogDb?.prepare) throw new Error('MINUTE_DB binding is missing');
  const sources = collectIdentitySources(queue, previous);
  const byKey = canonicalIdMap(sources);
  const unresolvedByKey = new Map();
  for (const source of sources) {
    const key = text(source?.track_key) || buddiesTrackKey(source);
    if (!key || byKey.has(key) || unresolvedByKey.has(key)) continue;
    unresolvedByKey.set(key, source);
  }
  const unresolved = [...unresolvedByKey.values()];
  if (unresolved.length) {
    const resolved = await resolveTracksBulk(catalogDb, metadataDb, unresolved, observedAt, {
      channelId: 'buddies',
      minuteAt: Math.floor(observedAt / 60_000) * 60_000,
      queueTracks: queue?.tracks?.length || 0,
      revisionId: null,
    });
    for (const descriptor of resolved) {
      const trackId = integer(descriptor?.trackId);
      const key = text(descriptor?.track_key) || buddiesTrackKey(descriptor);
      if (trackId != null && key) byKey.set(key, trackId);
    }
  }
  queue.tracks = (queue.tracks || []).map((track) => withCanonicalTrackId(track, byKey));
  return {
    daily: canonicalizeDaily(previous?.daily, byKey),
    likes: canonicalizeLikes(previous?.likes, byKey),
  };
}

async function loadState(bucket) {
  if (typeof bucket?.get !== 'function') return { available: false, state: null };
  try {
    const object = await bucket.get(BUDDIES_PLAYBACK_HOT_STATE_KEY);
    if (!object) return { available: true, state: null };
    const value = typeof object.json === 'function'
      ? await object.json()
      : JSON.parse(await object.text());
    return {
      available: true,
      state: [1, 2].includes(Number(value?.version)) ? value : null,
    };
  } catch {
    return { available: false, state: null };
  }
}

async function saveState(bucket, state, observedAt) {
  if (typeof bucket?.put !== 'function') return false;
  try {
    await bucket.put(BUDDIES_PLAYBACK_HOT_STATE_KEY, JSON.stringify(state), {
      httpMetadata: { contentType: 'application/json; charset=utf-8' },
      customMetadata: { version: '2', updated_at: String(observedAt) },
    });
    return true;
  } catch {
    return false;
  }
}

function playStatement(db, queue, track, observedAt) {
  const playedAt = integer(track?.expected_start_at) ?? observedAt;
  const trackId = integer(track?.track_id);
  if (trackId == null) throw new Error('Buddies playback track_id is unresolved');
  return db.prepare(`INSERT OR IGNORE INTO sh_track_plays(
      event_key,played_at,period_key,station_id,track_id,track_key,spotify_id,isrc,title,artist,duration_ms,thumbnail_url
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(
      track.event_key,
      playedAt,
      buddiesPlaybackPeriodKey(playedAt),
      integer(queue?.station_id),
      trackId,
      track.track_key,
      text(track?.spotify_id),
      text(track?.isrc)?.toUpperCase() || null,
      text(track?.title),
      text(track?.artist),
      integer(track?.duration_ms),
      text(track?.thumbnail_url, 2_048),
    );
}

function completedDailyStatement(db, daily, observedAt) {
  const row = dailyPublic(daily);
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

async function runStatements(db, statements) {
  if (!statements.length) return;
  if (typeof db?.batch === 'function') {
    await db.batch(statements);
    return;
  }
  for (const statement of statements) await statement.run();
}

export async function captureBuddiesPlayback(env, queue, observedAt = Date.now()) {
  const db = env?.DB || env?.BUDDIES_DB;
  const catalogDb = env?.MINUTE_DB;
  const bucket = env?.PAGES_RESPONSE_R2;
  if (!db?.prepare) throw new Error('Buddies D1 binding is missing');
  const currentQueue = normalizedQueue(queue);
  const loaded = await loadState(bucket);
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
  const canonical = await applyCanonicalTrackIds(catalogDb, db, currentQueue, previous, observedAt);
  let daily = canonical.daily?.period_key
    ? canonical.daily
    : emptyDaily(buddiesPlaybackPeriodKey(observedAt));
  let completedDay = null;
  const statements = [];
  const transitions = transitionedBuddiesTracks(previous?.queue, currentQueue.tracks);

  for (const track of transitions) {
    const playedAt = integer(track?.expected_start_at) ?? observedAt;
    const nextKey = buddiesPlaybackPeriodKey(playedAt);
    if (daily?.period_key && daily.period_key !== nextKey) {
      completedDay = dailyPublic(daily);
      statements.push(completedDailyStatement(db, daily, observedAt));
      daily = emptyDaily(nextKey);
    }
    daily = recordDailyTrack(daily, track, playedAt);
    statements.push(playStatement(db, currentQueue, track, observedAt));
  }

  if (!daily?.period_key) daily = emptyDaily(buddiesPlaybackPeriodKey(observedAt));
  if (daily.period_key !== buddiesPlaybackPeriodKey(observedAt) && !transitions.length) {
    completedDay = dailyPublic(daily);
    statements.push(completedDailyStatement(db, daily, observedAt));
    daily = emptyDaily(buddiesPlaybackPeriodKey(observedAt));
  }

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

  await runStatements(db, statements);
  const state = {
    version: 2,
    updated_at: observedAt,
    station_id: currentQueue.station_id,
    queue: currentQueue.tracks,
    daily,
    likes,
  };
  const stateSaved = await saveState(bucket, state, observedAt);
  return {
    queue: currentQueue,
    daily: dailyPublic(daily),
    completed_day: completedDay,
    transitions_written: transitions.length,
    like_changes_written: likeChanges,
    d1_rows_written: transitions.length + likeChanges * 2 + (completedDay ? 1 : 0),
    state_saved: stateSaved,
    skipped: false,
  };
}
