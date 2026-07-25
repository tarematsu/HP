import { sanitizeFailureDetail } from './collector-failure.js';
import {
  flushMinuteFactOutbox,
  sendMinuteFactJob,
  stageMinuteFactOutboxJob,
} from './minute-facts-queue.js';

const EMPTY_DELIVERY = Object.freeze({
  sent: 0,
  failed: 0,
  pending: false,
  current_sent: false,
});
const DAILY_CLEANUP_LIMIT = 500;
const RECOVERY_CLEANUP_LIMIT = 25;
let lastDailyCleanupMinute = null;

function count(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0;
}

async function flushPending(env, options) {
  if (!env?.DB?.prepare || !env?.MINUTE_FACT_QUEUE?.send) return EMPTY_DELIVERY;
  return flushMinuteFactOutbox(env, { limit: options.flushLimit });
}

async function cleanupSentOutbox(env, force = false, now = Date.now()) {
  if (!env?.DB?.prepare) return 0;
  const timestamp = new Date(now);
  const cleanupMinute = Math.floor(now / 60_000);
  const dailyDue = timestamp.getUTCHours() === 0
    && timestamp.getUTCMinutes() === 0
    && lastDailyCleanupMinute !== cleanupMinute;
  if (!force && !dailyDue) return 0;
  if (dailyDue) lastDailyCleanupMinute = cleanupMinute;
  const limit = force ? RECOVERY_CLEANUP_LIMIT : DAILY_CLEANUP_LIMIT;
  const result = await env.DB.prepare(`DELETE FROM sh_minute_fact_outbox WHERE job_id IN (
      SELECT job_id FROM sh_minute_fact_outbox
      WHERE status='sent'
        AND (payload_json='{}' OR payload_json LIKE '%"consumed":true%')
      ORDER BY COALESCE(sent_at,created_at) ASC LIMIT ?
    )`).bind(limit).run();
  return count(result?.meta?.changes);
}

export async function handoffMinuteFactJob(env, input = {}, options = {}, dependencies = {}) {
  const flush = dependencies.flushPending || flushPending;
  const cleanup = dependencies.cleanupSentOutbox || cleanupSentOutbox;
  const send = dependencies.sendMinuteFactJob || sendMinuteFactJob;
  const stage = dependencies.stageMinuteFactOutboxJob || stageMinuteFactOutboxJob;
  const pending = await flush(env, options);
  const outboxRowsDeleted = await cleanup(env, count(pending.sent) > 0);
  if (pending.pending === true || count(pending.failed) > 0) {
    const staged = await stage(env, input, options);
    const { message: _message, ...result } = staged;
    return {
      ...result,
      outbox_pending: true,
      pending_flushed: count(pending.sent),
      pending_failed: count(pending.failed),
      queue_send_ms: 0,
      queue_send_attempts: count(pending.sent) + count(pending.failed),
      outbox_rows_written: 1 + count(pending.sent) + count(pending.failed),
      outbox_rows_deleted: outboxRowsDeleted,
      direct_handoff: false,
      deferred_behind_pending: true,
    };
  }
  const queueStartedAt = Date.now();
  try {
    const sent = await send(env, input, options);
    return {
      ...sent,
      outbox_pending: pending.pending === true,
      pending_flushed: count(pending.sent),
      pending_failed: count(pending.failed),
      queue_send_ms: Math.max(0, Date.now() - queueStartedAt),
      queue_send_attempts: 1 + count(pending.sent) + count(pending.failed),
      outbox_rows_written: count(pending.sent) + count(pending.failed),
      outbox_rows_deleted: outboxRowsDeleted,
      direct_handoff: true,
    };
  } catch (error) {
    const staged = await stage(env, input, options);
    console.warn(JSON.stringify({
      event: 'minute_fact_direct_handoff_failed',
      job_id: staged.message?.job_id || null,
      error: sanitizeFailureDetail(error?.message || error),
    }));
    const { message: _message, ...result } = staged;
    return {
      ...result,
      outbox_pending: true,
      pending_flushed: count(pending.sent),
      pending_failed: count(pending.failed),
      queue_send_ms: Math.max(0, Date.now() - queueStartedAt),
      queue_send_attempts: 1 + count(pending.sent) + count(pending.failed),
      outbox_rows_written: 1 + count(pending.sent) + count(pending.failed),
      outbox_rows_deleted: outboxRowsDeleted,
      direct_handoff: false,
    };
  }
}
