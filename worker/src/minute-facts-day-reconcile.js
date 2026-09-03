import { enqueueMinuteFactJob } from './minute-facts-inbox.js';

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const DEFAULT_LOOKBACK_DAYS = 90;
const DEFAULT_CANDIDATE_LIMIT = 4;
const DEFAULT_ENQUEUE_LIMIT = 50;
const RECONCILE_BUILD_VERSION = 2;

const SOURCE_COLUMNS = `id,observed_at,channel_id,channel_alias,channel_name,station_id,
  is_launched,is_broadcasting,chat_status,listener_count,online_member_count,
  total_member_count,guest_count,total_listens,stream_goal,current_stream_count,
  host_account_id,host_handle,broadcast_start_time`;
const FINGERPRINT_COLUMNS = Object.freeze([
  'id', 'observed_at', 'channel_id', 'station_id', 'is_launched', 'is_broadcasting',
  'chat_status', 'listener_count', 'online_member_count', 'total_member_count',
  'guest_count', 'total_listens', 'stream_goal', 'current_stream_count',
  'host_account_id', 'host_handle', 'broadcast_start_time',
]);

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

function minuteAt(row) {
  return Math.floor(Number(row.observed_at) / 60_000) * 60_000;
}

function expectedSourceRecordId(row) {
  return `snapshot:${integer(row.id) ?? 0}:minute:${minuteAt(row)}:exact`;
}

function periodAtAge(currentDay, age) {
  const start = currentDay - age * DAY_MS;
  return { key: dayKey(start), start, end: start + DAY_MS };
}

export function minuteFactReconcileCandidates(now = Date.now(), options = {}) {
  const lookbackDays = positiveInteger(options.lookbackDays, DEFAULT_LOOKBACK_DAYS, 365);
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
      FROM sh_channel_snapshots INDEXED BY idx_sh_channel_snapshots_observed_id
      WHERE observed_at>=? AND observed_at<?
    ) WHERE source_rank=1
    ORDER BY observed_at ASC,id ASC`)
    .bind(period.start, period.end)
    .all();
  return result.results || [];
}

async function loadMaterializedFacts(minuteDb, period) {
  const result = await minuteDb.prepare(`SELECT channel_id,minute_at,source_record_id,source_priority
    FROM sh_minute_facts INDEXED BY idx_sh_minute_facts_time
    WHERE minute_at>=? AND minute_at<?`)
    .bind(period.start, period.end)
    .all();
  return new Map((result.results || []).map((row) => [minuteKey(row.channel_id, row.minute_at), row]));
}

async function loadRelevantJobState(minuteDb, period, expectedKeys) {
  const result = await minuteDb.prepare(`SELECT channel_id,minute_at,status
    FROM sh_minute_fact_jobs
    WHERE minute_at>=? AND minute_at<? AND status IN ('pending','processing','dead')`)
    .bind(period.start, period.end)
    .all();
  const jobs = { pending: 0, processing: 0, dead: 0 };
  for (const row of result.results || []) {
    if (!expectedKeys.has(minuteKey(row.channel_id, row.minute_at))) continue;
    if (row.status === 'pending') jobs.pending += 1;
    else if (row.status === 'processing') jobs.processing += 1;
    else if (row.status === 'dead') jobs.dead += 1;
  }
  return jobs;
}

function stableValue(value) {
  if (value == null) return '';
  return String(value).replaceAll('\\', '\\\\').replaceAll('|', '\\|');
}

function sourceFingerprint(rows) {
  let hash = 2166136261;
  for (const row of rows) {
    const text = FINGERPRINT_COLUMNS.map((column) => stableValue(row[column])).join('|');
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
  }
  return `${RECONCILE_BUILD_VERSION}:${rows.length}:${hash.toString(16).padStart(8, '0')}`;
}

function sourceWatermark(rows) {
  let maxId = 0;
  let maxObservedAt = 0;
  for (const row of rows) {
    maxId = Math.max(maxId, integer(row.id) || 0);
    maxObservedAt = Math.max(maxObservedAt, integer(row.observed_at) || 0);
  }
  return `${rows.length}:${maxObservedAt}:${maxId}`;
}

function classifyExpected(expected, materialized) {
  const missing = [];
  const stale = [];
  for (const row of expected) {
    const fact = materialized.get(minuteKey(row.channel_id, minuteAt(row)));
    if (!fact) {
      missing.push(row);
      continue;
    }
    if (fact.source_record_id !== expectedSourceRecordId(row) || Number(fact.source_priority || 0) < 90) {
      stale.push(row);
    }
  }
  return { missing, stale };
}

async function enqueueRebuild(env, row, period, generation, now) {
  return enqueueMinuteFactJob(env, {
    observedAt: row.observed_at,
    snapshot: compactSnapshot(row),
    queue: null,
    comments: { commentCount: null, commentTotal: null, degraded: true },
    rebuild: {
      source: 'daily_reconcile',
      mode: 'exact',
      period_key: period.key,
      source_generation: generation,
      build_version: RECONCILE_BUILD_VERSION,
      source_snapshot_id: integer(row.id),
      source_observed_at: integer(row.observed_at),
      requested_at: now,
    },
  }, {
    jobKind: 'rebuild',
    jobPriority: 150,
    requeueCompleted: true,
    forceRepair: true,
  });
}

export async function reconcileMinuteFactsForDay(env, period, now = Date.now()) {
  if (!env?.DB || !env?.MINUTE_DB) {
    return { complete: false, skipped: true, reason: 'db-binding-missing', periodKey: period?.key };
  }

  const expected = await loadExpectedMinutes(env.DB, period);
  const initialWatermark = sourceWatermark(expected);
  const generation = sourceFingerprint(expected);
  const materialized = await loadMaterializedFacts(env.MINUTE_DB, period);
  const { missing, stale } = classifyExpected(expected, materialized);
  const rebuild = [...missing, ...stale];
  const enqueueLimit = positiveInteger(
    env.MINUTE_FACT_DAY_REBUILD_ENQUEUE_LIMIT,
    DEFAULT_ENQUEUE_LIMIT,
    500,
  );
  let enqueued = 0;
  for (const row of rebuild.slice(0, enqueueLimit)) {
    const queued = await enqueueRebuild(env, row, period, generation, now);
    if (queued.enqueued) enqueued += 1;
  }

  const expectedKeys = new Set(expected.map((row) => minuteKey(row.channel_id, minuteAt(row))));
  const jobs = await loadRelevantJobState(env.MINUTE_DB, period, expectedKeys);
  const verified = await loadExpectedMinutes(env.DB, period);
  const finalWatermark = sourceWatermark(verified);
  const sourceChanged = initialWatermark !== finalWatermark || generation !== sourceFingerprint(verified);
  const sourceEmpty = expected.length === 0 && period.end <= Math.floor(now / DAY_MS) * DAY_MS;

  return {
    complete: !sourceChanged && rebuild.length === 0
      && jobs.pending === 0 && jobs.processing === 0 && jobs.dead === 0,
    periodKey: period.key,
    generation,
    buildVersion: RECONCILE_BUILD_VERSION,
    expected: expected.length,
    materialized: materialized.size,
    missing: missing.length,
    stale: stale.length,
    enqueued,
    jobs,
    sourceChanged,
    sourceEmpty,
    reason: sourceChanged ? 'source-changed-during-reconcile'
      : sourceEmpty ? 'source-empty-confirmed'
        : jobs.dead > 0 ? 'minute-facts-dead-jobs'
          : rebuild.length > 0 ? 'minute-facts-rebuild-pending'
            : null,
    blocked: jobs.dead > 0,
  };
}
