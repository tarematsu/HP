import {
  emptyPlaybackDaily,
  recordPlaybackDailyTrack,
  playbackDailyPublic,
  stationheadPlaybackPeriodKey,
  stationheadPlaybackInteger as integer,
} from './stationhead-playback-core.js';

export async function loadStationheadPlaybackState(bucket, key) {
  if (typeof bucket?.get !== 'function') return { available: false, state: null };
  try {
    const object = await bucket.get(key);
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

export async function saveStationheadPlaybackState(bucket, key, state, observedAt) {
  if (typeof bucket?.put !== 'function') return false;
  try {
    await bucket.put(key, JSON.stringify(state), {
      httpMetadata: { contentType: 'application/json; charset=utf-8' },
      customMetadata: { version: String(Number(state?.version) || 2), updated_at: String(observedAt) },
    });
    return true;
  } catch {
    return false;
  }
}

export function stationheadPlaybackPlayStatement(
  db,
  stationId,
  track,
  observedAt,
  sourceLabel = 'Stationhead',
) {
  const playedAt = integer(track?.expected_start_at) ?? observedAt;
  const trackId = integer(track?.track_id);
  if (trackId == null) throw new Error(`${sourceLabel} playback track_id is unresolved`);
  return db.prepare(`INSERT OR IGNORE INTO sh_track_plays(
      event_key,played_at,period_key,station_id,track_id,track_key
    ) VALUES(?,?,?,?,?,?)`)
    .bind(
      track.event_key,
      playedAt,
      stationheadPlaybackPeriodKey(playedAt),
      integer(stationId),
      trackId,
      track.track_key,
    );
}

export function stationheadCompletedDailyStatement(db, daily, observedAt) {
  const row = playbackDailyPublic(daily);
  return db.prepare(`INSERT INTO sh_track_daily_summary(
      period_key,total_plays,unique_tracks,tracks_json,updated_at
    ) VALUES(?,?,?,?,?)
    ON CONFLICT(period_key) DO UPDATE SET
      total_plays=excluded.total_plays,
      unique_tracks=excluded.unique_tracks,
      tracks_json=excluded.tracks_json,
      updated_at=excluded.updated_at
    WHERE excluded.updated_at>=sh_track_daily_summary.updated_at
      AND excluded.total_plays>=sh_track_daily_summary.total_plays`)
    .bind(row.period_key, row.total_plays, row.unique_tracks, JSON.stringify(row.tracks), observedAt);
}

export async function runStationheadPlaybackStatements(db, statements) {
  if (!statements.length) return;
  if (typeof db?.batch === 'function') {
    await db.batch(statements);
    return;
  }
  for (const statement of statements) await statement.run();
}

// Shared day rollover and play persistence plan; adapters retain their queue
// and likes schemas while counting transitions through one implementation.
export function planStationheadPlaybackDaily(db, stationId, previousDaily, transitions, observedAt, sourceLabel) {
  const currentKey = stationheadPlaybackPeriodKey(observedAt);
  const firstAt = integer(transitions[0]?.expected_start_at) ?? observedAt;
  let daily = previousDaily?.period_key ? previousDaily : emptyPlaybackDaily(stationheadPlaybackPeriodKey(firstAt));
  let completedDay = null;
  const completedDays = [];
  const statements = [];
  const complete = (nextKey) => {
    completedDay = playbackDailyPublic(daily);
    completedDays.push(completedDay);
    statements.push(stationheadCompletedDailyStatement(db, daily, observedAt));
    daily = emptyPlaybackDaily(nextKey);
  };
  for (const track of transitions) {
    const playedAt = integer(track?.expected_start_at) ?? observedAt;
    const nextKey = stationheadPlaybackPeriodKey(playedAt);
    if (daily.period_key !== nextKey) complete(nextKey);
    daily = recordPlaybackDailyTrack(daily, track, playedAt);
    statements.push(stationheadPlaybackPlayStatement(db, stationId, track, observedAt, sourceLabel));
  }
  if (daily.period_key !== currentKey) complete(currentKey);
  return { daily, completedDay, completedDays, statements };
}

