import {
  playbackDailyPublic,
  stationheadPlaybackPeriodKey,
} from './stationhead-playback-core.js';

function finite(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function integer(value) {
  const parsed = finite(value);
  return parsed == null ? null : Math.trunc(parsed);
}

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
    WHERE excluded.updated_at>=sh_track_daily_summary.updated_at`)
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
