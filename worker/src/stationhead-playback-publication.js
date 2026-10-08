import { saveTrackHistoryDayReadModel } from './pages-track-history-r2-shards.js';
import { playbackDailyPublic, stationheadPlaybackInteger as integer, stationheadPlaybackText as text } from './stationhead-playback-core.js';

function trackHistoryDayRange(period) {
  const fromTs = Date.parse(`${String(period || '')}T00:00:00Z`);
  if (!Number.isFinite(fromTs)) throw new Error(`invalid Stationhead playback day: ${period}`);
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

export async function publishStationheadPlaybackDay(bucket, source, daily, observedAt) {
  const row = Array.isArray(daily?.tracks) ? daily : playbackDailyPublic(daily);
  if (!row?.period_key) return null;
  return saveTrackHistoryDayReadModel(
    bucket,
    trackHistoryDayRange(row.period_key),
    trackHistoryRows(row),
    {
      source,
      updated_at: observedAt,
      source_row_count: Math.max(0, integer(row.total_plays) || 0),
    },
  );
}

