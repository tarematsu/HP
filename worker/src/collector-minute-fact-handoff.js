import { sanitizeFailureDetail } from './collector-failure.js';
import { processInlineMinuteFactJob } from './collector-minute-fact-inline.js';
import { flushResilientMinuteFactOutbox } from './collector-minute-fact-outbox.js';
import {
  sendMinuteFactJob,
  stageMinuteFactOutboxJob,
} from './minute-facts-queue.js';

const EMPTY_DELIVERY = Object.freeze({
  sent: 0,
  failed: 0,
  pending: false,
  current_sent: false,
  quarantined: 0,
  backoff_ms: 0,
});
const DAILY_CLEANUP_LIMIT = 500;
const RECOVERY_CLEANUP_LIMIT = 25;
const DEFAULT_OUTBOX_RECONCILE_MS = 60 * 60_000;
const MIN_OUTBOX_RETRY_MS = 60_000;
const outboxDeliveryStates = new WeakMap();
let lastDailyCleanupMinute = null;

function count(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0;
}

function enabled(value) {
  return value === true || value === 1 || /^(1|true|yes|on)$/i.test(String(value || ''));
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && Math.trunc(parsed) > 0 ? Math.trunc(parsed) : fallback;
}

function stateKey(env) {
  const db = env?.DB;
  return db && (typeof db === 'object' || typeof db === 'function') ? db : null;
}

function rememberOutboxState(env, pending, nextCheckAt) {
  const key = stateKey(env);
  if (!key) return;
  outboxDeliveryStates.set(key, {
    pending: pending === true,
    next_check_at: Number(nextCheckAt) || 0,
  });
}

function reconcileMs(env) {
  return positiveInteger(env?.MINUTE_FACT_OUTBOX_RECONCILE_MS, DEFAULT_OUTBOX_RECONCILE_MS);
}

export async function flushPendingMinuteFactOutbox(env, options = {}, dependencies = {}) {
  if (!env?.DB?.prepare || !env?.MINUTE_FACT_QUEUE?.send) return EMPTY_DELIVERY;
  const now = dependencies.now || Date.now;
  const current = Number(now());
  const key = stateKey(env);
  const cached = key ? outboxDeliveryStates.get(key) : null;
  if (cached && current < Number(cached.next_check_at || 0)) {
    return {
      ...EMPTY_DELIVERY,
      pending: cached.pending === true,
      backoff_ms: cached.pending
        ? Math.max(1, Number(cached.next_check_at) - current)
        : 0,
      cache_hit: true,
    };
  }

  const flush = dependencies.flushResilient || flushResilientMinuteFactOutbox;
  const result = await flush(env, { limit: options.flushLimit });
  const pending = result?.pending === true || count(result?.failed) > 0;
  const retryDelay = pending
    ? Math.max(MIN_OUTBOX_RETRY_MS, count(result?.backoff_ms))
    : reconcileMs(env);
  rememberOutboxState(env, pending, current + retryDelay);
  return { ...result, cache_hit: false };
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

function deliveryTelemetry(pending) {
  return {
    pending_flushed: count(pending.sent),
    pending_failed: count(pending.failed),
    outbox_rows_quarantined: count(pending.quarantined),
    outbox_backoff_ms: count(pending.backoff_ms),
    outbox_check_cached: pending.cache_hit === true ? 1 : 0,
  };
}

function outboxWriteEstimate(pending, currentStaged = false) {
  return Number(currentStaged)
    + count(pending.sent)
    + count(pending.failed)
    + count(pending.quarantined);
}

export async function handoffMinuteFactJob(env, input = {}, options = {}, dependencies = {}) {
  const cleanup = dependencies.cleanupSentOutbox || cleanupSentOutbox;
  const send = dependencies.sendMinuteFactJob || sendMinuteFactJob;
  const stage = dependencies.stageMinuteFactOutboxJob || stageMinuteFactOutboxJob;
  const processInline = dependencies.processInlineMinuteFactJob || processInlineMinuteFactJob;
  const now = dependencies.now || Date.now;
  const pending = dependencies.flushPending
    ? await dependencies.flushPending(env, options)
    : await flushPendingMinuteFactOutbox(env, options, dependencies);
  const outboxRowsDeleted = await cleanup(
    env,
    count(pending.sent) > 0 || count(pending.quarantined) > 0,
  );
  const telemetry = deliveryTelemetry(pending);
  if (pending.pending === true || count(pending.failed) > 0) {
    const staged = await stage(env, input, options);
    rememberOutboxState(
      env,
      true,
      Number(now()) + Math.max(MIN_OUTBOX_RETRY_MS, count(pending.backoff_ms)),
    );
    const { message: _message, ...result } = staged;
    return {
      ...result,
      outbox_pending: true,
      ...telemetry,
      queue_send_ms: 0,
      queue_send_attempts: count(pending.sent) + count(pending.failed),
      outbox_rows_written: outboxWriteEstimate(pending, true),
      outbox_rows_deleted: outboxRowsDeleted,
      direct_handoff: false,
      inline_handoff: false,
      deferred_behind_pending: true,
    };
  }

  let inlineFailed = false;
  if (enabled(env?.COLLECTOR_MINUTE_FACT_INLINE_ENABLED) && env?.MINUTE_DB?.prepare) {
    const inlineStartedAt = Number(now());
    try {
      const result = await processInline(env, input, options);
      rememberOutboxState(env, false, Number(now()) + reconcileMs(env));
      return {
        ...result,
        outbox_pending: false,
        ...telemetry,
        queue_send_ms: 0,
        queue_send_attempts: count(pending.sent) + count(pending.failed),
        inline_process_ms: Math.max(0, Number(now()) - inlineStartedAt),
        outbox_rows_written: outboxWriteEstimate(pending),
        outbox_rows_deleted: outboxRowsDeleted,
        direct_handoff: false,
        inline_handoff: true,
        inline_fallback: false,
      };
    } catch (error) {
      inlineFailed = true;
      console.warn(JSON.stringify({
        event: 'minute_fact_inline_handoff_failed',
        error: sanitizeFailureDetail(error?.message || error),
      }));
    }
  }

  const queueStartedAt = Number(now());
  try {
    const sent = await send(env, input, options);
    rememberOutboxState(env, false, Number(now()) + reconcileMs(env));
    return {
      ...sent,
      outbox_pending: false,
      ...telemetry,
      queue_send_ms: Math.max(0, Number(now()) - queueStartedAt),
      queue_send_attempts: 1 + count(pending.sent) + count(pending.failed),
      outbox_rows_written: outboxWriteEstimate(pending),
      outbox_rows_deleted: outboxRowsDeleted,
      direct_handoff: true,
      inline_handoff: false,
      inline_fallback: inlineFailed,
    };
  } catch (error) {
    const staged = await stage(env, input, options);
    rememberOutboxState(env, true, Number(now()) + MIN_OUTBOX_RETRY_MS);
    console.warn(JSON.stringify({
      event: 'minute_fact_direct_handoff_failed',
      job_id: staged.message?.job_id || null,
      error: sanitizeFailureDetail(error?.message || error),
    }));
    const { message: _message, ...result } = staged;
    return {
      ...result,
      outbox_pending: true,
      ...telemetry,
      queue_send_ms: Math.max(0, Number(now()) - queueStartedAt),
      queue_send_attempts: 1 + count(pending.sent) + count(pending.failed),
      outbox_rows_written: outboxWriteEstimate(pending, true),
      outbox_rows_deleted: outboxRowsDeleted,
      direct_handoff: false,
      inline_handoff: false,
      inline_fallback: inlineFailed,
    };
  }
}

export function resetMinuteFactHandoffCacheForTests(env = null) {
  const key = stateKey(env);
  if (key) outboxDeliveryStates.delete(key);
}

export const MINUTE_FACT_OUTBOX_FAST_PATH = Object.freeze({
  default_reconcile_ms: DEFAULT_OUTBOX_RECONCILE_MS,
  minimum_retry_ms: MIN_OUTBOX_RETRY_MS,
});
