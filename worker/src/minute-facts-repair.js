import { enqueueMinuteFactJob } from './minute-facts-inbox.js';
import { minuteBucket, timestampMs } from './minute-facts-store.js';

export const MINUTE_FACT_REPAIR_KEY = 'total-listener-20260710-13-v1';
export const MINUTE_FACT_REPAIR_PRIORITY = 110;
export const MINUTE_FACT_REPAIR_START = Date.UTC(2026, 6, 9, 15, 0, 0);
export const MINUTE_FACT_REPAIR_END = Date.UTC(2026, 6, 13, 15, 0, 0);
export const MAX_REPAIR_CANDIDATES = 100;
export const MAX_REPAIR_ENQUEUES = 100;
const DEFAULT_REPAIR_CANDIDATES = 20;
const DEFAULT_REPAIR_ENQUEUES = 4;
const REPAIR_REQUEUE_AFTER_MS = 2 * 60_000;
const REPAIR_SCAN_STATE_KEY = `repair-scan:${MINUTE_FACT_REPAIR_KEY}`;

export const MINUTE_FACT_REPAIR_SCHEMA_SQL = `CREATE TABLE IF NOT EXISTS sh_minute_fact_repairs (
  repair_key TEXT NOT NULL,
  fact_id INTEGER NOT NULL,
  channel_id INTEGER NOT NULL,
  minute_at INTEGER NOT NULL,
  source_snapshot_id INTEGER,
  source_snapshot_observed_at INTEGER,
  expected_current_stream_count INTEGER,
  expected_total_listens INTEGER,
  original_source_priority INTEGER,
  original_source_record_id TEXT,
  original_reported_current_stream_count INTEGER,
  original_reported_total_listens INTEGER,
  expected_source_record_id TEXT,
  status TEXT NOT NULL DEFAULT 'detected',
  last_error TEXT,
  detected_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(repair_key, fact_id)
)`;

const SOURCE_COLUMNS = `id,observed_at,channel_id,channel_alias,channel_name,station_id,
  is_launched,is_broadcasting,chat_status,listener_count,online_member_count,
  total_member_count,guest_count,total_listens,stream_goal,current_stream_count,
  host_account_id,host_handle,broadcast_start_time`;

function numberValue(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function integer(value) {
  const parsed = numberValue(value);
  return parsed == null ? null : Math.trunc(parsed);
}

function positiveInteger(value, fallback, maximum) {
  const parsed = integer(value);
  if (parsed == null || parsed <= 0) return fallback;
  return Math.min(parsed, maximum);
}

function safeJson(value, fallback = null) {
  try {
    const parsed = JSON.parse(String(value ?? ''));
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
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

function expectedRecordId(row) {
  return `repair:${MINUTE_FACT_REPAIR_KEY}:${row.channel_id}:${row.minute_at}`;
}

function suspectWhere(alias = '') {
  return `${alias}minute_at>=? AND ${alias}minute_at<? AND ${alias}reported_total_listens IS NOT NULL AND (
    (${alias}reported_current_stream_count IS NOT NULL
      AND ${alias}reported_current_stream_count=${alias}reported_total_listens)
    OR (${alias}reported_current_stream_count IS NULL AND (${alias}quality_flags & 64) != 0)
  )`;
}

async function loadRepairScanState(minuteDb) {
  const row = await minuteDb.prepare(`SELECT phase,cursor_observed_at,cursor_source_id
    FROM sh_migration_state WHERE migration_key=? LIMIT 1`)
    .bind(REPAIR_SCAN_STATE_KEY)
    .first();
  return {
    complete: row?.phase === 'complete',
    minute_at: Math.max(
      MINUTE_FACT_REPAIR_START - 1,
      integer(row?.cursor_observed_at) ?? (MINUTE_FACT_REPAIR_START - 1),
    ),
    fact_id: Math.max(0, integer(row?.cursor_source_id) ?? 0),
  };
}

async function loadSuspects(minuteDb, limit) {
  const scan = await loadRepairScanState(minuteDb);
  if (scan.complete) return { rows: [], scan_complete: true };
  const result = await minuteDb.prepare(`SELECT f.id,f.channel_id,f.minute_at,f.source_priority,
      f.source_record_id,f.reported_current_stream_count,f.reported_total_listens
    FROM sh_minute_facts f INDEXED BY idx_sh_minute_facts_time
    WHERE ${suspectWhere('f.')}
      AND (f.minute_at>? OR (f.minute_at=? AND f.id>?))
      AND NOT EXISTS (
        SELECT 1 FROM sh_minute_fact_repairs r
        WHERE r.repair_key=? AND r.fact_id=f.id
      )
    ORDER BY f.minute_at ASC,f.id ASC LIMIT ?`)
    .bind(
      MINUTE_FACT_REPAIR_START,
      MINUTE_FACT_REPAIR_END,
      scan.minute_at,
      scan.minute_at,
      scan.fact_id,
      MINUTE_FACT_REPAIR_KEY,
      limit,
    )
    .all();
  return { rows: result.results || [], scan_complete: false };
}

async function advanceRepairScan(minuteDb, suspects, now) {
  const last = suspects.at(-1);
  const phase = last ? 'scanning' : 'complete';
  const minuteAt = last ? integer(last.minute_at) : MINUTE_FACT_REPAIR_END;
  const factId = last ? integer(last.id) : 0;
  await minuteDb.prepare(`INSERT INTO sh_migration_state(
      migration_key,phase,cursor_observed_at,cursor_source_id,updated_at
    ) VALUES(?,?,?,?,?)
    ON CONFLICT(migration_key) DO UPDATE SET
      phase=CASE
        WHEN sh_migration_state.phase='complete' OR excluded.phase='complete' THEN 'complete'
        ELSE excluded.phase
      END,
      cursor_observed_at=CASE
        WHEN excluded.cursor_observed_at>sh_migration_state.cursor_observed_at
          THEN excluded.cursor_observed_at
        ELSE sh_migration_state.cursor_observed_at
      END,
      cursor_source_id=CASE
        WHEN excluded.cursor_observed_at>sh_migration_state.cursor_observed_at
          THEN excluded.cursor_source_id
        WHEN excluded.cursor_observed_at=sh_migration_state.cursor_observed_at
          THEN MAX(sh_migration_state.cursor_source_id,excluded.cursor_source_id)
        ELSE sh_migration_state.cursor_source_id
      END,
      updated_at=MAX(sh_migration_state.updated_at,excluded.updated_at)`)
    .bind(REPAIR_SCAN_STATE_KEY, phase, minuteAt, factId, now)
    .run();
  return phase === 'complete';
}

async function loadSource(sourceDb, fact) {
  return sourceDb.prepare(`SELECT ${SOURCE_COLUMNS} FROM sh_channel_snapshots
    WHERE channel_id=? AND observed_at>=? AND observed_at<?
    ORDER BY ABS(observed_at-?) ASC,id DESC LIMIT 1`)
    .bind(fact.channel_id, fact.minute_at, fact.minute_at + 60_000, fact.minute_at)
    .first();
}

async function loadHistoricalQueue(sourceDb, snapshot, observedAt) {
  if (Number(snapshot.is_broadcasting) === 0 || snapshot.station_id == null) return null;
  const row = await sourceDb.prepare(`SELECT station_id,queue_id,start_time,is_paused,raw_json
    FROM sh_queue_snapshots WHERE station_id IS ? AND observed_at<=?
    ORDER BY observed_at DESC,id DESC LIMIT 1`)
    .bind(snapshot.station_id, observedAt)
    .first();
  if (!row) return null;
  const queue = safeJson(row.raw_json);
  if (!queue || !Array.isArray(queue.tracks)) return null;
  const queueStart = timestampMs(queue.start_time ?? row.start_time);
  const broadcastStart = timestampMs(snapshot.broadcast_start_time);
  if (broadcastStart != null && queueStart != null && queueStart < broadcastStart - 5 * 60_000) {
    return null;
  }
  return {
    ...queue,
    station_id: integer(queue.station_id ?? row.station_id),
    queue_id: integer(queue.queue_id ?? row.queue_id),
    start_time: integer(queue.start_time ?? row.start_time),
    is_paused: integer(queue.is_paused ?? row.is_paused),
  };
}

async function loadCommentCount(sourceDb, snapshot, minuteAt) {
  if (snapshot.station_id == null) return null;
  const row = await sourceDb.prepare(`SELECT comment_count FROM sh_comment_minute_counts
    WHERE station_id=? AND bucket_start=? LIMIT 1`)
    .bind(snapshot.station_id, minuteAt)
    .first();
  return row?.comment_count == null ? null : integer(row.comment_count);
}

async function insertLedger(minuteDb, values, status, lastError, now) {
  await minuteDb.prepare(`INSERT OR IGNORE INTO sh_minute_fact_repairs(
      repair_key,fact_id,channel_id,minute_at,source_snapshot_id,source_snapshot_observed_at,
      expected_current_stream_count,expected_total_listens,original_source_priority,
      original_source_record_id,original_reported_current_stream_count,
      original_reported_total_listens,expected_source_record_id,status,last_error,
      detected_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(
      MINUTE_FACT_REPAIR_KEY,
      values.fact_id,
      values.channel_id,
      values.minute_at,
      integer(values.source_snapshot_id),
      integer(values.source_snapshot_observed_at),
      integer(values.expected_current_stream_count),
      integer(values.expected_total_listens),
      integer(values.original_source_priority),
      values.original_source_record_id || null,
      integer(values.original_reported_current_stream_count),
      integer(values.original_reported_total_listens),
      values.expected_source_record_id,
      status,
      lastError || null,
      now,
      now,
    )
    .run();
}

async function updateLedger(minuteDb, factId, status, lastError, now) {
  await minuteDb.prepare(`UPDATE sh_minute_fact_repairs SET status=?,last_error=?,updated_at=?
    WHERE repair_key=? AND fact_id=?`)
    .bind(status, lastError || null, now, MINUTE_FACT_REPAIR_KEY, factId)
    .run();
}

async function loadCurrentFact(minuteDb, factId) {
  return minuteDb.prepare(`SELECT channel_id,minute_at,source_priority,source_record_id,
      reported_current_stream_count,reported_total_listens
    FROM sh_minute_facts WHERE id=?`)
    .bind(factId)
    .first();
}

function currentMatchesRepair(fact, ledger) {
  return fact && fact.source_record_id === ledger.expected_source_record_id
    && Number(fact.source_priority) >= MINUTE_FACT_REPAIR_PRIORITY
    && integer(fact.reported_current_stream_count) === integer(ledger.expected_current_stream_count)
    && integer(fact.reported_total_listens) === integer(ledger.expected_total_listens);
}

function currentMatchesOriginal(fact, ledger) {
  return fact
    && integer(fact.source_priority) === integer(ledger.original_source_priority)
    && (fact.source_record_id || null) === (ledger.original_source_record_id || null)
    && integer(fact.reported_current_stream_count) === integer(ledger.original_reported_current_stream_count)
    && integer(fact.reported_total_listens) === integer(ledger.original_reported_total_listens);
}

async function registerCandidates(env, suspects, now, result) {
  for (const fact of suspects) {
    const source = await loadSource(env.DB, fact);
    const expectedTotal = integer(source?.total_listens);
    const expectedCurrent = integer(source?.current_stream_count);
    const common = {
      fact_id: integer(fact.id),
      channel_id: integer(fact.channel_id),
      minute_at: integer(fact.minute_at),
      source_snapshot_id: integer(source?.id),
      source_snapshot_observed_at: integer(source?.observed_at),
      expected_current_stream_count: expectedCurrent,
      expected_total_listens: expectedTotal,
      original_source_priority: integer(fact.source_priority),
      original_source_record_id: fact.source_record_id,
      original_reported_current_stream_count: integer(fact.reported_current_stream_count),
      original_reported_total_listens: integer(fact.reported_total_listens),
      expected_source_record_id: expectedRecordId(fact),
    };
    if (!source) {
      await insertLedger(env.MINUTE_DB, common, 'unresolved', 'source-snapshot-missing', now);
      result.unresolved += 1;
      continue;
    }
    if (expectedTotal == null || expectedCurrent == null) {
      await insertLedger(env.MINUTE_DB, common, 'unresolved', 'source-counter-missing', now);
      result.unresolved += 1;
      continue;
    }
    if (expectedCurrent === expectedTotal && expectedTotal === integer(fact.reported_total_listens)) {
      await insertLedger(env.MINUTE_DB, common, 'preserved', 'source-also-equals-total-listens', now);
      result.preserved += 1;
      continue;
    }
    if (expectedCurrent === expectedTotal || expectedTotal !== integer(fact.reported_total_listens)) {
      await insertLedger(env.MINUTE_DB, common, 'unresolved', 'source-fingerprint-mismatch', now);
      result.unresolved += 1;
      continue;
    }
    await insertLedger(env.MINUTE_DB, common, 'detected', null, now);
    result.detected += 1;
  }
}

async function processQueuedRepair(env, ledger, now, result, enqueueLimit) {
  const current = await loadCurrentFact(env.MINUTE_DB, ledger.fact_id);
  if (currentMatchesRepair(current, ledger)) {
    await updateLedger(env.MINUTE_DB, ledger.fact_id, 'repaired', null, now);
    result.repaired += 1;
    return;
  }
  if (!current || !currentMatchesOriginal(current, ledger)) {
    await updateLedger(env.MINUTE_DB, ledger.fact_id, 'conflict', 'fact-fingerprint-changed', now);
    result.preserved += 1;
    return;
  }
  if (String(ledger.status) === 'queued'
      && now - Number(ledger.updated_at || 0) < REPAIR_REQUEUE_AFTER_MS) {
    result.deferred += 1;
    return;
  }
  if (result.enqueued >= enqueueLimit) return;

  const source = await env.DB.prepare(`SELECT ${SOURCE_COLUMNS} FROM sh_channel_snapshots
    WHERE id=? LIMIT 1`).bind(ledger.source_snapshot_id).first();
  if (!source) {
    await updateLedger(env.MINUTE_DB, ledger.fact_id, 'unresolved', 'source-snapshot-disappeared', now);
    result.unresolved += 1;
    return;
  }
  const snapshot = compactSnapshot(source);
  const queue = await loadHistoricalQueue(env.DB, snapshot, ledger.source_snapshot_observed_at);
  const commentCount = await loadCommentCount(env.DB, snapshot, ledger.minute_at);
  const enqueue = await enqueueMinuteFactJob(env, {
    observedAt: ledger.source_snapshot_observed_at,
    snapshot,
    queue,
    comments: {
      commentCount,
      commentTotal: null,
      degraded: commentCount == null,
    },
    rebuild: {
      source: 'snapshot_rebuild',
      mode: 'exact',
      repair: true,
      repair_key: MINUTE_FACT_REPAIR_KEY,
      source_snapshot_id: ledger.source_snapshot_id,
      source_observed_at: ledger.source_snapshot_observed_at,
      source_priority: MINUTE_FACT_REPAIR_PRIORITY,
      source_record_id: ledger.expected_source_record_id,
    },
  }, {
    jobKind: 'repair',
    jobPriority: 200,
    requeueCompleted: true,
    forceRepair: true,
  });
  if (enqueue.enqueued) {
    await updateLedger(env.MINUTE_DB, ledger.fact_id, 'queued', null, now);
    result.enqueued += 1;
  }
}

async function processPending(env, now, result, candidateLimit, enqueueLimit) {
  const rows = await env.MINUTE_DB.prepare(`SELECT * FROM sh_minute_fact_repairs
    WHERE repair_key=? AND status IN ('detected','queued')
    ORDER BY updated_at ASC,fact_id ASC LIMIT ?`)
    .bind(MINUTE_FACT_REPAIR_KEY, candidateLimit)
    .all();
  for (const ledger of rows.results || []) {
    await processQueuedRepair(env, ledger, now, result, enqueueLimit);
  }
}

async function countPending(minuteDb) {
  const row = await minuteDb.prepare(`SELECT COUNT(*) AS count FROM sh_minute_fact_repairs
    WHERE repair_key=? AND status IN ('detected','queued')`)
    .bind(MINUTE_FACT_REPAIR_KEY)
    .first();
  return Number(row?.count || 0);
}

export async function runMinuteFactsRepair(env, now = Date.now()) {
  if (!env?.DB || !env?.MINUTE_DB) {
    return { skipped: true, reason: 'db-binding-missing', repair_key: MINUTE_FACT_REPAIR_KEY };
  }
  const candidateLimit = positiveInteger(
    env.MINUTE_FACT_REPAIR_CANDIDATE_LIMIT,
    DEFAULT_REPAIR_CANDIDATES,
    MAX_REPAIR_CANDIDATES,
  );
  const enqueueLimit = positiveInteger(
    env.MINUTE_FACT_REPAIR_ENQUEUE_LIMIT,
    DEFAULT_REPAIR_ENQUEUES,
    MAX_REPAIR_ENQUEUES,
  );
  const scan = await loadSuspects(env.MINUTE_DB, candidateLimit);
  const suspects = scan.rows;
  const result = {
    skipped: false,
    repair_key: MINUTE_FACT_REPAIR_KEY,
    candidate_limit: candidateLimit,
    enqueue_limit: enqueueLimit,
    scanned: suspects.length,
    detected: 0,
    enqueued: 0,
    repaired: 0,
    preserved: 0,
    unresolved: 0,
    deferred: 0,
  };
  await registerCandidates(env, suspects, now, result);
  const scanComplete = scan.scan_complete || await advanceRepairScan(env.MINUTE_DB, suspects, now);
  await processPending(env, now, result, candidateLimit, enqueueLimit);
  result.pending = await countPending(env.MINUTE_DB);
  result.complete = scanComplete && result.pending === 0;
  return result;
}
