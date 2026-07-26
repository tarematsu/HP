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

export const BUDDIES_COLLECTOR_CRON = '* * * * *';

function collectorRunId(scheduledAt) {
  const random = globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
  return `sh-buddies-collector:${scheduledAt}:${random}`;
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
  _ctx,
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
    return {
      collected: true,
      scheduled_at: scheduledAt,
      ...(collection && typeof collection === 'object' ? collection : {}),
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
