import { sanitizeFailureDetail } from './collector-failure.js';
import { flushMinuteFactOutbox } from './minute-facts-queue.js';

const DEFAULT_FLUSH_LIMIT = 3;
const MAX_FLUSH_LIMIT = 5;
const DEFAULT_MAX_ATTEMPTS = 5;
const BASE_RETRY_DELAY_MS = 60_000;
const MAX_RETRY_DELAY_MS = 15 * 60_000;

function integer(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : fallback;
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && Math.trunc(parsed) > 0 ? Math.trunc(parsed) : fallback;
}

export function minuteFactOutboxRetryDelayMs(attempts) {
  const count = integer(attempts);
  if (count <= 0) return 0;
  return Math.min(MAX_RETRY_DELAY_MS, BASE_RETRY_DELAY_MS * (2 ** Math.min(count - 1, 8)));
}

async function oldestPendingRow(env) {
  return env.DB.prepare(`SELECT job_id,payload_json,attempts,created_at,last_attempt_at,last_error
    FROM sh_minute_fact_outbox
    WHERE status='pending'
    ORDER BY created_at ASC LIMIT 1`).first();
}

async function pendingCount(env) {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM sh_minute_fact_outbox WHERE status='pending'",
  ).first();
  return integer(row?.count);
}

async function currentDeliveryState(env, jobId) {
  if (!jobId) return null;
  return env.DB.prepare(
    'SELECT status,payload_json FROM sh_minute_fact_outbox WHERE job_id=? LIMIT 1',
  ).bind(String(jobId)).first();
}

async function quarantineRow(env, row, now) {
  const error = sanitizeFailureDetail(row?.last_error || 'retry limit exceeded').slice(0, 500);
  let pointer = null;
  try {
    const payload = JSON.parse(String(row?.payload_json || ''));
    if (payload?.message_type === 'minute-fact-pointer') {
      pointer = {
        storage_key: String(payload.storage_key || ''),
        payload_bytes: integer(payload.payload_bytes),
      };
    }
  } catch {
    // Preserve the failure detail even when the payload itself is malformed.
  }
  const marker = JSON.stringify({
    quarantined: true,
    quarantined_at: now,
    attempts: integer(row?.attempts),
    last_error: error,
    ...(pointer ? { pointer } : {}),
  });
  const result = await env.DB.prepare(`UPDATE sh_minute_fact_outbox SET
      status='sent',payload_json=?,sent_at=?,last_attempt_at=?,last_error=?
    WHERE job_id=? AND status='pending'`)
    .bind(marker, now, now, `quarantined: ${error}`.slice(0, 800), row.job_id)
    .run();
  const quarantined = Number(result?.meta?.changes || 0) > 0;
  if (quarantined) {
    console.error(JSON.stringify({
      event: 'minute_fact_outbox_quarantined',
      job_id: String(row.job_id || ''),
      attempts: integer(row.attempts),
      error,
    }));
  }
  return quarantined;
}

function addDelivery(summary, delivery) {
  summary.sent += integer(delivery?.sent);
  summary.failed += integer(delivery?.failed);
  summary.current_sent ||= delivery?.current_sent === true;
}

export async function flushResilientMinuteFactOutbox(
  env,
  options = {},
  dependencies = {},
) {
  if (!env?.DB?.prepare || !env?.MINUTE_FACT_QUEUE?.send) {
    return {
      sent: 0,
      failed: 0,
      pending: true,
      current_sent: false,
      quarantined: 0,
      quarantined_job_ids: [],
      backoff_ms: 0,
      reason: 'queue-or-db-binding-missing',
    };
  }

  const flush = dependencies.flushMinuteFactOutbox || flushMinuteFactOutbox;
  const now = dependencies.now || Date.now;
  const limit = Math.min(
    MAX_FLUSH_LIMIT,
    positiveInteger(options.limit ?? options.flushLimit, DEFAULT_FLUSH_LIMIT),
  );
  const maxAttempts = positiveInteger(options.maxAttempts, DEFAULT_MAX_ATTEMPTS);
  const summary = {
    sent: 0,
    failed: 0,
    pending: false,
    current_sent: false,
    quarantined: 0,
    quarantined_job_ids: [],
    backoff_ms: 0,
  };

  for (let step = 0; step < limit; step += 1) {
    const row = await oldestPendingRow(env);
    if (!row) break;

    const attempts = integer(row.attempts);
    if (attempts >= maxAttempts) {
      const quarantinedAt = Number(now());
      if (!await quarantineRow(env, row, quarantinedAt)) {
        summary.pending = true;
        break;
      }
      summary.quarantined += 1;
      summary.quarantined_job_ids.push(String(row.job_id));
      continue;
    }

    const attemptedAt = Number(row.last_attempt_at || 0);
    const currentTime = Number(now());
    const delay = minuteFactOutboxRetryDelayMs(attempts);
    if (attemptedAt > 0 && delay > 0 && currentTime - attemptedAt < delay) {
      summary.pending = true;
      summary.backoff_ms = Math.max(1, attemptedAt + delay - currentTime);
      break;
    }

    const isCurrent = String(row.job_id) === String(options.currentJobId || '');
    const delivery = await flush(env, {
      limit: 1,
      ...(isCurrent ? {
        currentJobId: options.currentJobId,
        currentMessage: options.currentMessage,
      } : {}),
    });
    addDelivery(summary, delivery);

    if (integer(delivery?.failed) > 0) {
      const updated = await oldestPendingRow(env);
      const updatedAttempts = integer(updated?.attempts);
      if (updated && String(updated.job_id) === String(row.job_id) && updatedAttempts >= maxAttempts) {
        const quarantinedAt = Number(now());
        if (await quarantineRow(env, updated, quarantinedAt)) {
          summary.quarantined += 1;
          summary.quarantined_job_ids.push(String(updated.job_id));
          continue;
        }
      }
      summary.pending = true;
      summary.backoff_ms = minuteFactOutboxRetryDelayMs(updatedAttempts || attempts + 1);
      break;
    }

    if (integer(delivery?.sent) === 0) {
      summary.pending = delivery?.pending !== false;
      break;
    }
  }

  summary.pending = (await pendingCount(env)) > 0;
  const current = await currentDeliveryState(env, options.currentJobId);
  if (current?.status === 'sent') {
    summary.current_sent = !String(current.payload_json || '').includes('"quarantined":true');
  }
  return summary;
}

export const COLLECTOR_MINUTE_FACT_OUTBOX_POLICY = Object.freeze({
  default_flush_limit: DEFAULT_FLUSH_LIMIT,
  max_flush_limit: MAX_FLUSH_LIMIT,
  default_max_attempts: DEFAULT_MAX_ATTEMPTS,
  base_retry_delay_ms: BASE_RETRY_DELAY_MS,
  max_retry_delay_ms: MAX_RETRY_DELAY_MS,
});
