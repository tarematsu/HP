import {
  ROUND_GOAL_STEP,
  ROUND_GOAL_COUNT,
  linearRegressionPrediction,
  linearRegressionPredictionFromAggregate,
  linearRegressionPredictions,
  linearRegressionPredictionsFromAggregate,
  dashboardGoalTargets,
  dashboardGoalPredictions,
} from '../../../packages/sh-shared/dashboard-prediction.mjs';

export {
  ROUND_GOAL_STEP,
  ROUND_GOAL_COUNT,
  linearRegressionPrediction,
  linearRegressionPredictionFromAggregate,
  linearRegressionPredictions,
  linearRegressionPredictionsFromAggregate,
  dashboardGoalTargets,
  dashboardGoalPredictions,
};
const COMMENT_VELOCITY_WINDOW_MS = 2 * 60_000;

export function hostScopeFromSnapshot(snapshot) {
  const hostAccountIdRaw = snapshot?.host_account_id;
  const hostAccountId = hostAccountIdRaw === undefined || hostAccountIdRaw === null || hostAccountIdRaw === ''
    ? null
    : Number(hostAccountIdRaw);
  if (Number.isFinite(hostAccountId) && hostAccountId > 0) {
    return { column: 'host_account_id', value: hostAccountId };
  }

  const hostHandle = String(snapshot?.host_handle || '').trim();
  if (hostHandle) {
    return { column: 'host_handle', value: hostHandle };
  }

  return null;
}

function hostScopedLatestSql(metricColumn, hostScope) {
  const hostClause = hostScope ? ` AND ${hostScope.column} = ?` : '';
  return `SELECT observed_at,${metricColumn}
FROM sh_channel_snapshots
WHERE observed_at>=? AND observed_at<?${hostClause}
ORDER BY observed_at DESC,id DESC LIMIT 1`;
}

function hostScopedBinds(hostScope, start, end) {
  return hostScope ? [start, end, hostScope.value] : [start, end];
}

const HOST_METRIC_CACHE_MS = 15 * 60 * 1000;
const hostMetricCache = new Map();

function hostMetricCacheKey(metricColumn, hostScope, start, end) {
  return [metricColumn, hostScope?.column || '', hostScope?.value || '', start, end].join(':');
}

export async function cachedHostMetric(db, metricColumn, hostScope, start, end, now = Date.now()) {
  if (!['total_member_count', 'total_listens'].includes(metricColumn)) {
    throw new Error(`unsupported host metric: ${metricColumn}`);
  }
  const key = hostMetricCacheKey(metricColumn, hostScope, start, end);
  const cached = hostMetricCache.get(key);
  if (cached?.expiresAt > now && Object.hasOwn(cached, 'value')) return cached.value;
  const value = await db.prepare(hostScopedLatestSql(metricColumn, hostScope))
    .bind(...hostScopedBinds(hostScope, start, end))
    .first();
  const entry = {
    value: value || null,
    expiresAt: Date.now() + HOST_METRIC_CACHE_MS,
  };
  hostMetricCache.set(key, entry);
  while (hostMetricCache.size > 16) hostMetricCache.delete(hostMetricCache.keys().next().value);
  return entry.value;
}

export function resetHostMetricCache() {
  hostMetricCache.clear();
}

export function commentVelocityExpression(alias) {
  return `COALESCE((
    SELECT SUM(counts.comment_count)
    FROM sh_comment_minute_counts AS counts
    WHERE counts.station_id=${alias}.station_id
      AND counts.bucket_start>=${alias}.observed_at-${COMMENT_VELOCITY_WINDOW_MS}
      AND counts.bucket_start<=${alias}.observed_at
  ),${alias}.comment_velocity,0)`;
}

function historyBucketSql(whereClause) {
  return `WITH ranked AS (
  SELECT snapshots.id,snapshots.observed_at,snapshots.listener_count,snapshots.online_member_count,snapshots.total_member_count,
    snapshots.total_listens,snapshots.current_stream_count,snapshots.stream_goal,
    MAX(${commentVelocityExpression('snapshots')}) OVER (
      PARTITION BY CAST(snapshots.observed_at/300000 AS INTEGER)
    ) AS comment_velocity_max,
    ROW_NUMBER() OVER (
      PARTITION BY CAST(snapshots.observed_at/300000 AS INTEGER)
      ORDER BY snapshots.observed_at DESC,snapshots.id DESC
    ) AS rn
  FROM sh_channel_snapshots AS snapshots
  WHERE ${whereClause}
)
SELECT observed_at,listener_count,online_member_count,total_member_count,
  total_listens,current_stream_count,stream_goal,comment_velocity_max AS comment_velocity
FROM ranked WHERE rn=1 ORDER BY observed_at ASC LIMIT 300`;
}

export const HISTORY_24H_SQL = historyBucketSql("snapshots.observed_at >= (unixepoch('now','-24 hours')*1000)");
export const HISTORY_SINCE_SQL = historyBucketSql('snapshots.observed_at>?');

export const PREDICTION_24H_SQL = `WITH ranked AS (
  SELECT id,observed_at,current_stream_count,
    ROW_NUMBER() OVER (
      PARTITION BY CAST(observed_at/300000 AS INTEGER)
      ORDER BY observed_at DESC,id DESC
    ) AS bucket_rank
  FROM sh_channel_snapshots
  WHERE observed_at >= (unixepoch('now','-24 hours')*1000)
    AND current_stream_count IS NOT NULL
), points AS (
  SELECT observed_at,
    CAST(current_stream_count AS REAL) AS y,
    (observed_at - MIN(observed_at) OVER ()) / 3600000.0 AS x,
    ROW_NUMBER() OVER (ORDER BY observed_at DESC,id DESC) AS latest_rank
  FROM ranked
  WHERE bucket_rank=1
)
SELECT COUNT(*) AS sample_count,
  MIN(observed_at) AS first_t,
  MAX(observed_at) AS last_t,
  AVG(x) AS x_mean,
  AVG(y) AS y_mean,
  AVG(x*y) AS xy_mean,
  AVG(x*x) AS xx_mean,
  MAX(CASE WHEN latest_rank=1 THEN y END) AS latest_y
FROM points`;

export function publicLatest(latest, channel, station, owner, goal) {
  if (!latest) return null;
  return {
    observed_at: latest.observed_at,
    channel_id: latest.channel_id,
    channel_alias: latest.channel_alias,
    channel_name: latest.channel_name,
    station_id: latest.station_id,
    is_launched: latest.is_launched,
    is_broadcasting: latest.is_broadcasting,
    chat_status: latest.chat_status,
    listener_count: latest.listener_count,
    online_member_count: latest.online_member_count,
    total_member_count: latest.total_member_count,
    guest_count: latest.guest_count,
    total_listens: latest.total_listens,
    stream_goal: goal,
    current_stream_count: latest.current_stream_count ?? station?.streaming_party?.current_stream_count ?? null,
    host_account_id: latest.host_account_id,
    host_handle: latest.host_handle,
    broadcast_start_time: latest.broadcast_start_time,
    comment_velocity: latest.comment_velocity,
    description: channel.description || station.status || null,
    artist_name: channel.artist_name || null,
    accent_color: channel.accent_color || null,
    channel_image: channel.images?.medium?.url || null,
    logo_image: channel.images?.logo?.medium?.url || null,
    host_image: owner.thumbnail?.url || owner.medium?.url || null,
  };
}

export function compactQueueStatus(latestQueue, latest, playback, totalItems, loadedItems = totalItems) {
  if (!latestQueue) return null;
  const playing = latest?.is_broadcasting !== 0
    && latest?.is_broadcasting !== false
    && !latestQueue.is_paused
    && playback.currentIndex >= 0;
  return {
    is_paused: Boolean(latestQueue.is_paused),
    playing,
    current_index: playback.currentIndex,
    progress_ms: playback.progressMs,
    anchor_at: playback.anchorAt,
    queue_end_at: playback.queueEndAt,
    total_items: totalItems,
    returned_items: loadedItems,
    loaded_items: loadedItems,
    has_more: loadedItems < totalItems,
  };
}
