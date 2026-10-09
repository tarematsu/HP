import {
  loadTrackHistoryData,
  TRACK_HISTORY_SQL,
} from '../../packages/sh-shared/track-history-restored-handler.mjs';

import { PERIOD_BOUNDARY_TOLERANCE_MS } from '../../packages/sh-shared/period-completeness.mjs';

const DAY_MS = 86_400_000;
const TRACK_HISTORY_QUEUE_LOOKBACK_MS = 2 * DAY_MS;
const RAW_QUEUE_STARTS_SQL = `WITH RECURSIVE queue_starts AS (
      SELECT DISTINCT station_id,start_time
      FROM sh_queue_items
      WHERE start_time IS NOT NULL AND start_time < ?
    )`;
const DIRECT_QUEUE_STARTS_SQL = `WITH RECURSIVE queue_bounds AS (
      SELECT ? AS range_end
    ), history_channel_snapshots AS MATERIALIZED (
      SELECT f.id,f.minute_at AS observed_at,
        COALESCE(context.station_id_override,session.station_id) AS station_id,
        f.is_broadcasting AS is_launched,f.is_broadcasting
      FROM queue_bounds bounds
      CROSS JOIN sh_minute_facts f INDEXED BY idx_sh_minute_facts_time
      LEFT JOIN sh_minute_fact_context_v2 context ON context.fact_id=f.id
      LEFT JOIN sh_broadcast_sessions session ON session.id=f.broadcast_session_id
        AND context.fact_id IS NOT NULL
      WHERE f.minute_at>=bounds.range_end-${TRACK_HISTORY_QUEUE_LOOKBACK_MS}-${PERIOD_BOUNDARY_TOLERANCE_MS}
        AND f.minute_at<=bounds.range_end+${PERIOD_BOUNDARY_TOLERANCE_MS}
    ), history_queue_snapshots AS MATERIALIZED (
      SELECT f.id,f.observed_at,
        COALESCE(context.station_id_override,session.station_id,revision.station_id) AS station_id,
        revision.queue_start_time AS start_time,COALESCE(f.is_paused,0) AS is_paused
      FROM queue_bounds bounds
      CROSS JOIN sh_minute_facts f INDEXED BY idx_sh_minute_facts_observed_id
      JOIN sh_minute_fact_context_v2 context ON context.fact_id=f.id
      JOIN sh_queue_revisions revision ON revision.id=context.queue_revision_id
      LEFT JOIN sh_broadcast_sessions session ON session.id=f.broadcast_session_id
      WHERE f.observed_at>=bounds.range_end-${TRACK_HISTORY_QUEUE_LOOKBACK_MS}
        AND f.observed_at<bounds.range_end
        AND context.queue_available=1
        AND revision.queue_start_time IS NOT NULL
    ), queue_starts AS MATERIALIZED (
      SELECT starts.station_id,starts.start_time,starts.latest_revision_id
      FROM sh_track_history_queue_starts starts INDEXED BY idx_sh_track_history_queue_starts_time
      CROSS JOIN queue_bounds bounds
      WHERE starts.start_time>=bounds.range_end-${TRACK_HISTORY_QUEUE_LOOKBACK_MS}
        AND starts.start_time<bounds.range_end
    ), materialized_queue_items AS MATERIALIZED (
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
          FROM sh_track_counter_current counters
          WHERE counters.occurrence_key='revision:'||CAST(revisions.id AS TEXT)||':'||CAST(items.position AS TEXT)
        ),items.bite_count) AS bite_count,
        NULL AS raw_json
      FROM queue_starts starts
      JOIN sh_queue_revisions revisions ON revisions.id=starts.latest_revision_id
      JOIN sh_queue_revision_items items ON items.revision_id=revisions.id
    )`;

// Seek compact facts once before joining sparse context. Expanding the compatibility
// views inside evidence joins can materialize the entire fact/context history.
const DIRECT_TRACK_HISTORY_SQL = TRACK_HISTORY_SQL
  .replace(RAW_QUEUE_STARTS_SQL, DIRECT_QUEUE_STARTS_SQL)
  .replaceAll('JOIN sh_queue_items items', 'JOIN materialized_queue_items items')
  .replaceAll('FROM sh_queue_items q', 'FROM materialized_queue_items q')
  .replaceAll('sh_channel_snapshots', 'history_channel_snapshots')
  .replaceAll('sh_queue_snapshots', 'history_queue_snapshots');

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

export async function loadDirectRevisionTrackHistoryData(
  db,
  fromTs,
  toTs,
  maxGroupedRows,
  includeLikes,
) {
  const data = await loadTrackHistoryData(
    directRevisionDatabase(db),
    fromTs,
    toTs,
    maxGroupedRows,
    includeLikes,
  );
  // D1 returns actual query costs even when Query Insights has already rotated
  // past the repair window. Log only bounds and costs, never SQL or bindings.
  console.log(JSON.stringify({
    event: 'track_history_reconstruction_d1_cost',
    from: fromTs,
    to: toTs,
    rows_read: data.result?.meta?.rows_read ?? null,
    rows_written: data.result?.meta?.rows_written ?? null,
    duration_ms: data.result?.meta?.duration ?? null,
  }));
  return data;
}
