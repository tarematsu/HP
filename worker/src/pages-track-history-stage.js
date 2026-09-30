import {
  TRACK_HISTORY_GRACE_MS,
  TRACK_HISTORY_SQL,
} from '../../site/functions/lib/track-history-restored-handler.js';
import { loadTrackRanking } from '../../site/functions/lib/track-ranking.js';
import { mergeTrackHistoryExcludedDates } from './pages-track-history-support.js';
import { TRACK_HISTORY_STAGE_KEY } from './pages-track-history-cycle.js';
import {
  loadTrackHistoryDayReadModel,
  materializeTrackHistoryRangeThroughR2,
} from './pages-track-history-r2-shards.js';
import { loadTrackHistoryDayIndex } from './pages-track-history-day-index.js';

const TRACK_RANKING_LIMIT = 500;
const BACKFILL_KEY = 'track-history-backfill';
const STATUS_KEY = 'track-history-status';
const TRACK_HISTORY_EPOCH = Date.UTC(2024, 4, 1);
const DAY_MS = 86_400_000;
const TRACK_HISTORY_QUEUE_LOOKBACK_MS = 2 * DAY_MS;
const UNBOUNDED_QUEUE_STARTS_SQL = `WITH RECURSIVE queue_starts AS (
      SELECT DISTINCT station_id,start_time
      FROM sh_queue_items
      WHERE start_time IS NOT NULL AND start_time < ?
    )`;
const BOUNDED_QUEUE_STARTS_SQL = `WITH RECURSIVE queue_bounds AS (
      SELECT ? AS range_end
    ), queue_starts AS (
      SELECT starts.station_id,starts.start_time
      FROM sh_track_history_queue_starts starts
      CROSS JOIN queue_bounds bounds
      WHERE starts.start_time>=bounds.range_end-${TRACK_HISTORY_QUEUE_LOOKBACK_MS}
        AND starts.start_time<bounds.range_end
    )`;
const BOUNDED_TRACK_HISTORY_SQL = TRACK_HISTORY_SQL.replace(
  UNBOUNDED_QUEUE_STARTS_SQL,
  BOUNDED_QUEUE_STARTS_SQL,
);

if (BOUNDED_TRACK_HISTORY_SQL === TRACK_HISTORY_SQL) {
  throw new Error('track-history queue-start budget rewrite did not match');
}

export function boundedTrackHistorySql() {
  return BOUNDED_TRACK_HISTORY_SQL;
}

function validTimestamp(value) {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp >= 0 ? timestamp : null;
}

function dayText(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function nonNegativeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function rankingLikeTotal(ranking) {
  const summaryTotal = nonNegativeNumber(ranking?.summary?.total_like_count);
  if (summaryTotal != null) return summaryTotal;
  return (ranking?.rows || []).reduce((sum, row) => {
    const value = nonNegativeNumber(row?.latest_like_count);
    return sum + (value ?? 0);
  }, 0);
}

function statusLikeTotal(status) {
  const summaryTotal = nonNegativeNumber(status?.ranking_summary?.total_like_count);
  if (summaryTotal != null) return summaryTotal;
  return (status?.ranking || []).reduce((sum, row) => {
    const value = nonNegativeNumber(row?.latest_like_count);
    return sum + (value ?? 0);
  }, 0);
}

export function buildLikeRankingSummary(ranking, previousStatus, now) {
  const currentDay = dayText(now);
  const previousDay = dayText(now - DAY_MS);
  const previousSummary = previousStatus?.ranking_summary || {};
  const previousGeneratedAt = validTimestamp(previousStatus?.generated_at);
  const previousTotalDay = String(
    previousSummary.total_like_count_day
      || (previousGeneratedAt == null ? '' : dayText(previousGeneratedAt)),
  );

  let previousDayTotal = null;
  if (
    previousSummary.total_like_count_day === currentDay
    && previousSummary.previous_day_total_like_count_day === previousDay
  ) {
    previousDayTotal = nonNegativeNumber(previousSummary.previous_day_total_like_count);
  } else if (previousTotalDay === previousDay) {
    previousDayTotal = statusLikeTotal(previousStatus);
  }

  const totalLikeCount = rankingLikeTotal(ranking);
  return {
    ...(ranking?.summary || {}),
    total_like_count: totalLikeCount,
    total_like_count_day: currentDay,
    previous_day_total_like_count: previousDayTotal,
    previous_day_total_like_count_day: previousDayTotal == null ? null : previousDay,
    total_like_count_previous_day_delta: previousDayTotal == null
      ? null
      : totalLikeCount - previousDayTotal,
  };
}

function parsedPayload(row) {
  try {
    return row?.payload_json ? JSON.parse(row.payload_json) : null;
  } catch {
    return null;
  }
}

const SHARD_SCHEMA_SQL = [
  `CREATE TABLE IF NOT EXISTS sh_pages_payload_read_model (
    model_key TEXT PRIMARY KEY,
    payload_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
];

async function ensureShardSchema(db) {
  await db.batch(SHARD_SCHEMA_SQL.map((sql) => db.prepare(sql)));
}

async function payloadRow(db, key) {
  return db.prepare(`SELECT payload_json
    FROM sh_pages_payload_read_model
    WHERE model_key=?
    LIMIT 1`).bind(key).first();
}

export async function loadTrackHistoryStage(db) {
  try {
    return parsedPayload(await payloadRow(db, TRACK_HISTORY_STAGE_KEY));
  } catch (error) {
    if (!/no such table/i.test(String(error?.message || error))) throw error;
    await ensureShardSchema(db);
    return null;
  }
}

export async function saveTrackHistoryPayload(db, key, payload, now) {
  await db.prepare(`INSERT INTO sh_pages_payload_read_model(model_key,payload_json,updated_at)
    VALUES(?,?,?) ON CONFLICT(model_key) DO UPDATE SET
    payload_json=excluded.payload_json,updated_at=excluded.updated_at`)
    .bind(key, JSON.stringify(payload), now).run();
}

export function saveTrackHistoryStage(db, stage, now) {
  return saveTrackHistoryPayload(db, TRACK_HISTORY_STAGE_KEY, stage, now);
}

async function trackHistoryCoverage(r2, range) {
  const index = await loadTrackHistoryDayIndex(r2);
  if (!index) return null;
  const fromDay = dayText(range.fromTs);
  const toDay = dayText(range.toTs - 1);
  const selected = index.dates.filter((day) => day >= fromDay && day <= toDay);
  const models = await Promise.all(selected.map((day) => loadTrackHistoryDayReadModel(r2, day)));
  return {
    earliest_date: index.dates[0] || null,
    latest_date: index.dates.at(-1) || null,
    recent_row_count: models.reduce((sum, model) => sum + Number(model?.payload?.rows?.length || 0), 0),
  };
}

function completedResults(stage, kind) {
  return stage.tasks
    .filter((task) => task.kind === kind)
    .map((task) => stage.completed?.[task.id])
    .filter(Boolean);
}

function fullExcludedDates(results) {
  return [...new Set(results.flatMap((result) => result.excludedDates || []).map(String).filter(Boolean))].sort();
}

function incrementalExcludedDates(stage) {
  let dates = Array.isArray(stage.previous_status?.excluded_play_count_dates)
    ? stage.previous_status.excluded_play_count_dates
    : [];
  for (const task of stage.tasks.filter((item) => item.kind === 'recent')) {
    const result = stage.completed?.[task.id];
    dates = mergeTrackHistoryExcludedDates(dates, result?.excludedDates, task.range);
  }
  return dates;
}

function backfillStatus(stage, now) {
  const range = stage.ranges.backfill;
  if (!range) return { next_to: TRACK_HISTORY_EPOCH, completed: true, updated_at: now };
  return {
    next_to: range.fromTs,
    completed: range.fromTs <= TRACK_HISTORY_EPOCH,
    updated_at: now,
  };
}

export async function finalizeTrackHistoryStatus(env, stage, now, dependencies = {}) {
  if (!env?.PAGES_RESPONSE_R2?.get) throw new Error('track-history R2 binding is missing');
  const loadRanking = dependencies.loadRanking || loadTrackRanking;
  const [coverage, ranking] = await Promise.all([
    (dependencies.coverage || trackHistoryCoverage)(env.PAGES_RESPONSE_R2, stage.ranges.full_recent),
    loadRanking(env.MINUTE_DB, { limit: TRACK_RANKING_LIMIT }),
  ]);
  const recentResults = completedResults(stage, 'recent');
  const previousSourceRowCount = Number(stage.previous_status?.source_row_count);
  const previousSourceRefreshedAt = validTimestamp(
    stage.previous_status?.source_row_count_refreshed_at
      ?? stage.previous_status?.full_reconciled_at
      ?? stage.previous_status?.generated_at,
  );
  const full = stage.refresh_mode === 'full';
  const sourceRowCount = full || !Number.isFinite(previousSourceRowCount)
    ? recentResults.reduce((sum, result) => sum + (Number(result.sourceRowCount) || 0), 0)
    : previousSourceRowCount;
  const sourceRowCountRefreshedAt = full || previousSourceRefreshedAt == null
    ? now
    : previousSourceRefreshedAt;
  const excludedDates = full ? fullExcludedDates(recentResults) : incrementalExcludedDates(stage);
  const recentRange = stage.ranges.recent;
  const backfillRange = stage.ranges.backfill;
  const status = {
    ok: true,
    from: coverage?.earliest_date || dayText(recentRange.fromTs),
    to: coverage?.latest_date || dayText(recentRange.toTs - 1),
    row_count: Math.max(0, Number(coverage?.recent_row_count || 0)),
    source_row_count: sourceRowCount,
    source_row_count_refreshed_at: sourceRowCountRefreshedAt,
    source_truncated: false,
    excluded_play_count_dates: excludedDates,
    ranking: ranking.rows,
    ranking_summary: buildLikeRankingSummary(ranking, stage.previous_status, now),
    ranking_scope: 'all-time-latest-counter',
    grace_ms: TRACK_HISTORY_GRACE_MS,
    backfill_completed: !backfillRange || backfillRange.fromTs <= TRACK_HISTORY_EPOCH,
    backfill_from: backfillRange ? dayText(backfillRange.fromTs) : null,
    backfill_to: backfillRange ? dayText(backfillRange.toTs - 1) : null,
    refresh_mode: stage.refresh_mode,
    refresh_from: dayText(recentRange.fromTs),
    refresh_to: dayText(recentRange.toTs - 1),
    full_reconciled_at: full ? now : stage.previous_full_at,
    generated_at: now,
  };
  const save = dependencies.savePayload || saveTrackHistoryPayload;
  await save(env.MINUTE_DB, BACKFILL_KEY, backfillStatus(stage, now), now);
  await save(env.MINUTE_DB, STATUS_KEY, status, now);
  return status;
}

export async function runLateTrackHistoryShard(env, stage, timestamp, dependencies = {}) {
  const nextTask = stage.tasks.find((task) => !stage.completed?.[task.id]);
  if (!nextTask) return null;
  if (!env?.PAGES_RESPONSE_R2?.get || !env?.PAGES_RESPONSE_R2?.put) {
    throw new Error('track-history R2 binding is missing');
  }
  const refreshDay = dependencies.refreshDay || materializeTrackHistoryRangeThroughR2;
  const result = await refreshDay(
    env.BUDDIES_DB,
    env.MINUTE_DB,
    nextTask.range,
    timestamp,
    {
      r2: env.PAGES_RESPONSE_R2,
      generation: stage.generation,
      cleanupDay: nextTask.cleanup_day !== false,
    },
  );
  stage.completed = { ...(stage.completed || {}), [nextTask.id]: result };
  stage.updated_at = timestamp;
  const save = dependencies.saveStage || saveTrackHistoryStage;
  await save(env.MINUTE_DB, stage, timestamp);
  return {
    skipped: false,
    generated_at: timestamp,
    task: {
      kind: 'track-history-shard',
      key: nextTask.id,
      generation: stage.generation,
      shard_kind: nextTask.kind,
      from: result.from,
      to: result.to,
    },
    shard: result,
    completed: Object.keys(stage.completed).length,
    total: stage.tasks.length,
    responses: [],
    failed: 0,
  };
}
