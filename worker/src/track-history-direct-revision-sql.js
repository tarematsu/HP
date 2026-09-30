import {
  loadTrackHistoryData,
  TRACK_HISTORY_SQL,
} from '../../site/functions/lib/track-history-restored-handler.js';

const DAY_MS = 86_400_000;
const TRACK_HISTORY_QUEUE_LOOKBACK_MS = 2 * DAY_MS;
const RAW_QUEUE_STARTS_SQL = `WITH RECURSIVE queue_starts AS (
      SELECT DISTINCT station_id,start_time
      FROM sh_queue_items
      WHERE start_time IS NOT NULL AND start_time < ?
    )`;
const DIRECT_QUEUE_STARTS_SQL = `WITH RECURSIVE queue_bounds AS (
      SELECT ? AS range_end
    ), queue_starts AS (
      SELECT starts.station_id,starts.start_time,starts.latest_revision_id
      FROM sh_track_history_queue_starts starts
      CROSS JOIN queue_bounds bounds
      WHERE starts.start_time>=bounds.range_end-${TRACK_HISTORY_QUEUE_LOOKBACK_MS}
        AND starts.start_time<bounds.range_end
    ), materialized_queue_items AS (
      SELECT CAST(revisions.id*1000000+items.position AS INTEGER) AS id,
        revisions.effective_at AS observed_at,
        starts.station_id,
        revisions.queue_id,
        starts.start_time,
        items.position,
        items.track_id,
        items.queue_track_id,
        items.stationhead_track_id,
        items.spotify_id,
        items.deezer_id,
        items.isrc,
        items.duration_ms,
        NULL AS preview_url,
        COALESCE((
          SELECT counters.count_value
          FROM sh_track_counter_changes counters
          WHERE counters.occurrence_key='revision:'||CAST(revisions.id AS TEXT)||':'||CAST(items.position AS TEXT)
          ORDER BY counters.observed_at DESC,counters.id DESC
          LIMIT 1
        ),items.bite_count) AS bite_count,
        NULL AS raw_json
      FROM queue_starts starts
      JOIN sh_queue_revisions revisions ON revisions.id=starts.latest_revision_id
      JOIN sh_queue_revision_items items ON items.revision_id=revisions.id
    )`;

const DIRECT_TRACK_HISTORY_SQL = TRACK_HISTORY_SQL
  .replace(RAW_QUEUE_STARTS_SQL, DIRECT_QUEUE_STARTS_SQL)
  .replaceAll('JOIN sh_queue_items items', 'JOIN materialized_queue_items items')
  .replaceAll('FROM sh_queue_items q', 'FROM materialized_queue_items q');

if (DIRECT_TRACK_HISTORY_SQL === TRACK_HISTORY_SQL
    || DIRECT_TRACK_HISTORY_SQL.includes('sh_queue_items')) {
  throw new Error('track-history direct revision-item rewrite did not match');
}

export function directRevisionTrackHistorySql() {
  return DIRECT_TRACK_HISTORY_SQL;
}

function directRevisionDatabase(db) {
  return new Proxy(db, {
    get(target, property) {
      if (property === 'prepare') {
        return (sql) => target.prepare(sql === TRACK_HISTORY_SQL ? DIRECT_TRACK_HISTORY_SQL : sql);
      }
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

export function loadDirectRevisionTrackHistoryData(
  db,
  fromTs,
  toTs,
  maxGroupedRows,
  includeLikes,
) {
  return loadTrackHistoryData(
    directRevisionDatabase(db),
    fromTs,
    toTs,
    maxGroupedRows,
    includeLikes,
  );
}
