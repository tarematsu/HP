const OTHER_CRON_ID = 'other-cron';
const HEALTHY_STATUSES = new Set(['ok', 'running']);

function integer(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function positiveMs(value, fallback, minimum = 1_000) {
  const parsed = integer(value);
  return parsed != null && parsed > 0 ? Math.max(minimum, parsed) : fallback;
}

function age(now, value) {
  const timestamp = integer(value);
  return timestamp == null ? null : Math.max(0, now - timestamp);
}

async function readTask(db) {
  return db.prepare(`SELECT status,last_attempt_at,last_success_at,last_error
    FROM sh_collector_status WHERE collector_id=? LIMIT 1`).bind(OTHER_CRON_ID).first();
}

export async function readOtherHealth(env, now = Date.now()) {
  if (!env?.OTHER_DB?.prepare) throw new Error('OTHER_DB binding missing');
  const row = await readTask(env.OTHER_DB);
  // Match the GitHub Actions runner-health policy so the public endpoint does not
  // fail before the operational monitor when a scheduled run is delayed.
  const staleAfterMs = positiveMs(env.OTHER_CRON_STALE_MS, 75 * 60_000, 60 * 60_000);
  const ageMs = age(now, row?.last_attempt_at);
  const stale = ageMs == null || ageMs >= staleAfterMs;
  const failed = Boolean(row) && !HEALTHY_STATUSES.has(row.status);
  return {
    ok: Boolean(row) && !stale && !failed,
    setup_required: !row,
    stale,
    stale_after_ms: staleAfterMs,
    age_ms: ageMs,
    last_attempt_at: integer(row?.last_attempt_at),
    last_success_at: integer(row?.last_success_at),
    last_error_present: Boolean(row?.last_error),
    status: row?.status || null,
  };
}
