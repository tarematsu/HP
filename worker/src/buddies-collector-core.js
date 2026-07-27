import './fetch-guard.js';

import {
  clearCollectorFailure,
  recordCollectorFailure,
  sanitizeFailureDetail,
} from './collector-failure.js';
import { ingestRawCollection } from './ingest-channel-optimized-entry.js';
import { claimPrimaryRunLock, releasePrimaryRunLock } from './primary-run-lock.js';
import { collectRawChannel } from './raw-collector-entry.js';
import { rawCollectorEnv } from './runtime-env.js';

const EMPTY_DEPENDENCIES = Object.freeze({});
const MINUTE_MS = 60_000;
const LIVE_RECOVERY_POLL_INTERVAL_MS = 5 * MINUTE_MS;

export const BUDDIES_COLLECTOR_CRON = '* * * * *';

function collectorRunId(scheduledAt) {
  const random = globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
  return `sh-buddies-collector:${scheduledAt}:${random}`;
}

export function minuteLiveRecoveryDispatchDue(scheduledAt) {
  const timestamp = Number(scheduledAt);
  if (!Number.isFinite(timestamp) || timestamp < 0) return false;
  return Math.floor(timestamp / LIVE_RECOVERY_POLL_INTERVAL_MS)
    !== Math.floor((timestamp - MINUTE_MS) / LIVE_RECOVERY_POLL_INTERVAL_MS);
}

function recoveryBindingsAvailable(env) {
  const queue = env?.MINUTE_LIVE_DERIVE_QUEUE;
  return typeof env?.MINUTE_DB?.prepare === 'function'
    && (typeof queue?.send === 'function' || typeof queue?.sendBatch === 'function');
}

async function dispatchMinuteLiveRecovery(activeEnv, scheduledAt, ctx, dependencies) {
  if (!minuteLiveRecoveryDispatchDue(scheduledAt)) return null;
  const injected = dependencies.dispatchPendingMinuteFacts;
  if (!injected && !recoveryBindingsAvailable(activeEnv)) return null;
  try {
    const dispatch = injected
      || (await import('./minute-maintenance-entry.js')).dispatchPendingMinuteFacts;
    return await dispatch(activeEnv, {
      ...(dependencies.minuteRecovery || EMPTY_DEPENDENCIES),
      now: scheduledAt,
    }, ctx);
  } catch (error) {
    const detail = sanitizeFailureDetail(error?.message || error);
    console.warn(JSON.stringify({
      event: 'minute_live_recovery_dispatch_failed',
      scheduled_at: scheduledAt,
      error: detail,
    }));
    return { failed: true, error: detail };
  }
}

async function clearRecordedFailure(clear, env) {
  try {
    await clear(env);
  } catch (error) {
    console.error(JSON.stringify({
      event: 'buddies_collection_failure_clear_failed',
      error: sanitizeFailureDetail(error?.message || error),
    }));
  }
}

export async function runBuddiesCollectorScheduled(
  controller,
  env,
  ctx,
  dependencies = EMPTY_DEPENDENCIES,
) {
  const cron = String(controller?.cron || '');
  if (cron !== BUDDIES_COLLECTOR_CRON) {
    return { skipped: true, reason: 'unsupported-buddies-collector-cron', cron };
  }

  const now = dependencies.now || Date.now;
  const scheduledAt = Number(controller?.scheduledTime) || now();
  const activeEnv = rawCollectorEnv(env);
  const holderId = dependencies.holderId || collectorRunId(scheduledAt);
  const claim = dependencies.claimPrimaryRunLock || claimPrimaryRunLock;
  const release = dependencies.releasePrimaryRunLock || releasePrimaryRunLock;
  const record = dependencies.recordCollectorFailure || recordCollectorFailure;
  const clear = dependencies.clearCollectorFailure || clearCollectorFailure;
  const claimed = await claim(activeEnv, holderId, now());
  if (!claimed) {
    return {
      skipped: true,
      reason: 'collector-run-already-active',
      scheduled_at: scheduledAt,
    };
  }

  const collect = dependencies.collectRawChannel || collectRawChannel;
  const collectionDependencies = {
    ...(dependencies.collection || EMPTY_DEPENDENCIES),
    ingestRawCollection: dependencies.ingestRawCollection || ingestRawCollection,
  };
  try {
    const collection = await collect(activeEnv, collectionDependencies);
    await clearRecordedFailure(clear, activeEnv);
    await release(activeEnv, holderId, now());
    const minuteLiveRecovery = await dispatchMinuteLiveRecovery(
      activeEnv,
      scheduledAt,
      ctx,
      dependencies,
    );
    return {
      collected: true,
      scheduled_at: scheduledAt,
      ...(collection && typeof collection === 'object' ? collection : {}),
      ...(minuteLiveRecovery ? { minute_live_recovery: minuteLiveRecovery } : {}),
    };
  } catch (error) {
    let recorded = null;
    try {
      recorded = await record(activeEnv, error, 'collector_unknown', 'cron', scheduledAt);
    } catch (recordError) {
      recorded = {
        recorded: false,
        recordError: sanitizeFailureDetail(recordError?.message || recordError),
      };
    }
    console.error(JSON.stringify({
      event: 'buddies_collection_failed',
      scheduled_at: scheduledAt,
      error: sanitizeFailureDetail(error?.message || error),
      diagnosis_code: recorded?.diagnosis?.code || null,
      diagnosis_stage: recorded?.diagnosis?.stage || null,
      failure_recorded: recorded?.recorded === true,
      failure_record_error: recorded?.recordError || null,
    }));
    // Keep the primary-run lease until TTL expiry on a failed or aborted run.
    // Cloudflare cancelling our await does not guarantee the underlying work stopped.
    throw error;
  }
}

export default {
  scheduled: runBuddiesCollectorScheduled,
};
