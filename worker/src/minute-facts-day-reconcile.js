import { enqueueMinuteFactJob } from './minute-facts-inbox.js';

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const DEFAULT_LOOKBACK_DAYS = 14;
const DEFAULT_CANDIDATE_LIMIT = 3;
const DEFAULT_ENQUEUE_LIMIT = 50;

const SOURCE_COLUMNS = `id,observed_at,channel_id,channel_alias,channel_name,station_id,
  is_launched,is_broadcasting,chat_status,listener_count,online_member_count,
  total_member_count,guest_count,total_listens,stream_goal,current_stream_count,
  host_account_id,host_handle,broadcast_start_time`;

function integer(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

function positiveInteger(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = integer(value);
  if (parsed == null || parsed <= 0) return fallback;
  return Math.min(parsed, maximum);
}

function compactSnapshot(row = {}) {
  return {
    channel_id: integer(row.channel_id),
    channel_alias: row.channel_alias || null,
    channel_name: row.channel_name || null,
    station_id: integer(row.station_id),
    is_launched: integer(row.is_launched),
    is_broadcasting: integer(row.is_broadcasting),
    chat_status: row.chat_status || null,
    listener_count: integer(row.listener_count),
    online_member_count: integer(row.online_member_count),
    total_member_count: integer(row.total_member_count),
    guest_count: integer(row.guest_count),
    total_listens: integer(row.total_listens),
    stream_goal: integer(row.stream_goal),
    current_stream_count: integer(row.current_stream_count),
    host_account_id: integer(row.host_account_id),
    host_handle: row.host_handle || null,
    broadcast_start_time: integer(row.broadcast_start_time),
  };
}

function dayKey(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function minuteKey(channelId, minuteAt) {
  return `${channelId}:${minuteAt}`;
}

function periodAtAge(currentDay, age) {
  const start = currentDay - age * DAY_MS;
  return { key: dayKey(start), start, end: start + DAY_MS };
}

export function minuteFactReconcileCandidates(now = Date.now(), options = {}) {
  const lookbackDays = positiveInteger(options.lookbackDays, DEFAULT_LOOKBACK_DAYS, 90);
  const limit = positiveInteger(options.limit, DEFAULT_CANDIDATE_LIMIT, lookbackDays);
  const currentDay = Math.floor(now / DAY_MS) * DAY_MS;
  const periods = [periodAtAge(currentDay, 1)];
  if (lookbackDays <= 1 || limit <= 1) return periods;
  const historicalSpan = lookbackDays - 1;
  const rotation = Math.floor(now / HOUR_MS) % historicalSpan;
  for (let offset = 0; periods.length < limit; offset += 1) {
    const age = 2 + ((rotation + offset) % historicalSpan);
    periods.push(periodAtAge(currentDay, age));
  }
  return periods;
}

async function loadExpectedMinutes(sourceDb, period) {
  const result = await sourceDb.prepare(`SELECT ${SOURCE_COLUMNS} FROM (
      SELECT ${SOURCE_COLUMNS},ROW_NUMBER() OVER (
        PARTITION BY channel_id,CAST(observed_at/60000 AS INTEGER)
        ORDER BY observed_at DESC,id DESC
      ) AS source_rank
      FROM sh_channel_snapshots
      WHERE observed_at>=? AND observed_at<?
    ) WHERE source_rank=1
    ORDER BY observed_at ASC,id ASC`)
    .bind(period.start, period.end)
    .all();
  return result.results || [];
}

async function loadMaterializedKeys(minuteDb, period) {
  const result = await minuteDb.prepare(`SELECT channel_id,minute_at
    FROM sh_minute_facts INDEXED BY idx_sh_minute_facts_time
    WHERE minute_at>=? AND minute_at<?`)
    .bind(period.start, period.end)
    .all();
  return new Set((result.results || []).map((row) => minuteKey(row.channel_id, row.minute_at)));
}

async function loadJobState(minuteDb, period) {
  const row = await minuteDb.prepare(`SELECT
      COUNT(*) FILTER (WHERE status='pending') AS pending_count,
      COUNT(*) FILTER (WHERE status='processing') AS processing_count,
      COUNT(*) FILTER (WHERE status='dead') AS dead_count
    FROM sh_minute_fact_jobs
    WHERE minute_at>=? AND minute_at<? AND status IN ('pending','processing','dead')`)
    .bind(period.start, period.end)
    .first();
  return {
    pending: Number(row?.pending_count || 0),
    processing: Number(row?.processing_count || 0),
    dead: Number(row?.dead_count || 0),
  };
}

function sourceGeneration(rows) {
  let maxId = 0;
  let maxObservedAt = 0;
  for (const row of rows) {
    maxId = Math.max(maxId, integer(row.id) || 0);
    maxObservedAt = Math.max(maxObservedAt, integer(row.observed_at) || 0);
  }
  return `${rows.length}:${maxObservedAt}:${maxId}`;
}

export async function reconcileMinuteFactsForDay(env, period, now = Date.now()) {
  if (!env?.DB || !env?.MINUTE_DB) {
    return { complete: false, skipped: true, reason: 'db-binding-missing', periodKey: period?.key };
  }
  const [expected, materialized] = await Promise.all([
    loadExpectedMinutes(env.DB, period),
    loadMaterializedKeys(env.MINUTE_DB, period),
  ]);
  const missing = expected.filter((row) => {
    const minuteAt = Math.floor(Number(row.observed_at) / 60_000) * 60_000;
    return !materialized.has(minuteKey(row.channel_id, minuteAt));
  });
  const enqueueLimit = positiveInteger(
    env.MINUTE_FACT_DAY_REBUILD_ENQUEUE_LIMIT,
    DEFAULT_ENQUEUE_LIMIT,
    500,
  );
  let enqueued = 0;
  for (const row of missing.slice(0, enqueueLimit)) {
    const queued = await enqueueMinuteFactJob(env, {
      observedAt: row.observed_at,
      snapshot: compactSnapshot(row),
      queue: null,
      comments: { commentCount: null, commentTotal: null, degraded: true },
      rebuild: {
        source: 'daily_reconcile',
        mode: 'exact',
        period_key: period.key,
        source_snapshot_id: integer(row.id),
        source_observed_at: integer(row.observed_at),
        requested_at: now,
      },
    }, {
      jobKind: 'rebuild',
      jobPriority: 150,
      requeueCompleted: false,
      forceRepair: false,
    });
    if (queued.enqueued) enqueued += 1;
  }
  const jobs = await loadJobState(env.MINUTE_DB, period);
  return {
    complete: expected.length > 0 && missing.length === 0
      && jobs.pending === 0 && jobs.processing === 0 && jobs.dead === 0,
    periodKey: period.key,
    generation: sourceGeneration(expected),
    expected: expected.length,
    materialized: materialized.size,
    missing: missing.length,
    enqueued,
    jobs,
    blocked: jobs.dead > 0,
  };
}
