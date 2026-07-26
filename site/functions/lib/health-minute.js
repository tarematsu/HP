const ACTIVE_TASKS = Object.freeze(['derive', 'recovery', 'rebuild']);
const DEFAULT_PENDING_STALE_MS = 15 * 60_000;
const DEFAULT_PENDING_ALERT_COUNT = 20;
const DEFAULT_DERIVE_STALE_MS = 25 * 60_000;
const DEFAULT_MAINTENANCE_STALE_MS = 25 * 60_000;
const RUNTIME_STATE_URL = 'https://sh-runtime-orchestrator.internal/internal/minute-runtime-state';

const INBOX_SQL = `SELECT
  stats.pending_count,stats.processing_count,stats.dead_count,
  stats.live_pending_count,
  COALESCE(pending_age.oldest_pending_at,stats.oldest_pending_minute) AS oldest_pending_minute,
  stats.updated_at
FROM sh_minute_fact_inbox_stats stats
LEFT JOIN sh_minute_fact_pending_age pending_age ON pending_age.id=stats.id
WHERE stats.id='global'
LIMIT 1`;

const LEGACY_SQL = `SELECT
  task_name,last_started_at,last_success_at,last_failure_at,last_duration_ms,
  last_error,runs_total,succeeded_total,failed_total,processed_total,
  job_failures_total,last_processed_count,last_failed_count,pending_count,
  processing_count,dead_count,oldest_pending_minute,updated_at
FROM sh_minute_fact_runtime_state
WHERE task_name IN ('derive','recovery','rebuild')
ORDER BY task_name`;

function integer(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function positiveMs(value, fallback) {
  const parsed = integer(value);
  return parsed != null && parsed > 0 ? parsed : fallback;
}

function nonNegative(value) {
  return Math.max(0, integer(value, 0));
}

function taskStaleMs(taskName, env) {
  return taskName === 'derive'
    ? positiveMs(env.MINUTE_DERIVE_STALE_MS, DEFAULT_DERIVE_STALE_MS)
    : positiveMs(env.MINUTE_MAINTENANCE_STALE_MS, DEFAULT_MAINTENANCE_STALE_MS);
}

function pendingPolicy(env = {}) {
  return {
    count: Math.max(
      DEFAULT_PENDING_ALERT_COUNT,
      integer(env.MINUTE_FACT_PENDING_ALERT_COUNT, DEFAULT_PENDING_ALERT_COUNT),
    ),
    ageMs: Math.max(
      DEFAULT_PENDING_STALE_MS,
      positiveMs(env.MINUTE_FACT_PENDING_ALERT_MS, DEFAULT_PENDING_STALE_MS),
    ),
  };
}

function hasAllRuntimeTasks(tasks) {
  if (!Array.isArray(tasks)) return false;
  const names = new Set(tasks.map((task) => String(task?.task_name || '')));
  return ACTIVE_TASKS.every((taskName) => names.has(taskName));
}

function inboxRuntimeRows(row = {}) {
  const updatedAt = integer(row.updated_at, Date.now());
  const derive = {
    task_name: 'derive',
    source: 'inbox',
    event_driven: 1,
    last_started_at: updatedAt,
    last_success_at: updatedAt,
    last_failure_at: null,
    last_duration_ms: 0,
    last_error: null,
    runs_total: 0,
    succeeded_total: 0,
    failed_total: 0,
    processed_total: 0,
    job_failures_total: 0,
    last_processed_count: 0,
    last_failed_count: 0,
    pending_count: nonNegative(row.pending_count),
    processing_count: nonNegative(row.processing_count),
    dead_count: nonNegative(row.dead_count),
    oldest_pending_minute: integer(row.oldest_pending_minute),
    updated_at: updatedAt,
  };
  const retired = (taskName) => ({
    task_name: taskName,
    source: 'retired',
    retired: 1,
    last_started_at: updatedAt,
    last_success_at: updatedAt,
    last_failure_at: null,
    last_duration_ms: 0,
    last_error: null,
    runs_total: 0,
    succeeded_total: 0,
    failed_total: 0,
    processed_total: 0,
    job_failures_total: 0,
    last_processed_count: 0,
    last_failed_count: 0,
    pending_count: 0,
    processing_count: 0,
    dead_count: 0,
    oldest_pending_minute: null,
    updated_at: updatedAt,
  });
  return [derive, retired('recovery'), retired('rebuild')];
}

export function minuteTaskHealth(row, now, env = {}) {
  const taskName = String(row?.task_name || '');
  const retired = row?.retired === true || Number(row?.retired) === 1;
  const eventDriven = row?.event_driven === true || Number(row?.event_driven) === 1;
  const lastStartedAt = integer(row?.last_started_at);
  const lastSuccessAt = integer(row?.last_success_at);
  const lastFailureAt = integer(row?.last_failure_at, 0);
  const oldestPendingMinute = integer(row?.oldest_pending_minute);
  const pendingCount = nonNegative(row?.pending_count);
  const deadCount = nonNegative(row?.dead_count);
  const ageMs = lastStartedAt == null ? null : Math.max(0, now - lastStartedAt);
  const staleAfterMs = taskStaleMs(taskName, env);
  const policy = pendingPolicy(env);
  const backlogOwner = taskName === 'derive';
  const stale = retired || eventDriven ? false : ageMs == null || ageMs >= staleAfterMs;
  const pendingStale = !retired
    && backlogOwner
    && pendingCount >= policy.count
    && oldestPendingMinute != null
    && oldestPendingMinute > 0
    && oldestPendingMinute <= now - policy.ageMs;
  const lastRunFailed = !retired && lastFailureAt > (lastSuccessAt || 0);
  return {
    task_name: taskName,
    ok: retired || (!stale
      && (!backlogOwner || deadCount === 0)
      && !pendingStale
      && !lastRunFailed),
    source: String(row?.source || 'runtime-state'),
    mode: retired ? 'retired' : eventDriven ? 'event-driven' : 'periodic',
    retired,
    stale,
    stale_after_ms: staleAfterMs,
    age_ms: ageMs,
    last_started_at: lastStartedAt,
    last_success_at: lastSuccessAt,
    last_failure_at: integer(row?.last_failure_at),
    last_duration_ms: nonNegative(row?.last_duration_ms),
    last_error_present: Boolean(row?.last_error),
    runs_total: nonNegative(row?.runs_total),
    succeeded_total: nonNegative(row?.succeeded_total),
    failed_total: nonNegative(row?.failed_total),
    processed_total: nonNegative(row?.processed_total),
    job_failures_total: nonNegative(row?.job_failures_total),
    last_processed_count: nonNegative(row?.last_processed_count),
    last_failed_count: nonNegative(row?.last_failed_count),
    pending_count: pendingCount,
    processing_count: nonNegative(row?.processing_count),
    dead_count: deadCount,
    oldest_pending_minute: oldestPendingMinute,
    backlog_owner: backlogOwner,
    pending_alert_count: policy.count,
    pending_alert_ms: policy.ageMs,
    pending_stale: pendingStale,
    last_run_failed: lastRunFailed,
    updated_at: integer(row?.updated_at),
  };
}

export async function readMinuteHealth(env, now = Date.now()) {
  if (!env?.MINUTE_DB?.prepare) throw new Error('MINUTE_DB binding missing');
  let rows = null;

  try {
    const inbox = await env.MINUTE_DB.prepare(INBOX_SQL).first();
    if (inbox) rows = inboxRuntimeRows(inbox);
  } catch (error) {
    console.warn(JSON.stringify({
      event: 'pages_minute_inbox_health_failed',
      error: String(error?.message || error).slice(0, 500),
    }));
  }

  if (!rows && env?.PAGES_READ_MODEL_SERVICE?.fetch) {
    try {
      const response = await env.PAGES_READ_MODEL_SERVICE.fetch(RUNTIME_STATE_URL, { method: 'GET' });
      if (response?.ok) {
        const payload = await response.json();
        if (hasAllRuntimeTasks(payload?.tasks)) rows = payload.tasks;
      }
    } catch (error) {
      console.warn(JSON.stringify({
        event: 'pages_minute_runtime_state_service_failed',
        error: String(error?.message || error).slice(0, 500),
      }));
    }
  }
  if (!rows) {
    const result = await env.MINUTE_DB.prepare(LEGACY_SQL).all();
    rows = result?.results || [];
  }
  const byName = new Map(rows.map((row) => [String(row.task_name), row]));
  const tasks = ACTIVE_TASKS.map((taskName) => {
    const row = byName.get(taskName);
    return row ? minuteTaskHealth(row, now, env) : { task_name: taskName, ok: false, setup_required: true, stale: true };
  });
  return { ok: tasks.every((task) => task.ok), tasks };
}
