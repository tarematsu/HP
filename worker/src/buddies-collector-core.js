import './fetch-guard.js';

import { sanitizeFailureDetail } from './collector-failure.js';
import { ingestRawCollection } from './ingest-channel-optimized-entry.js';
import { collectRawChannel } from './raw-collector-entry.js';
import { rawCollectorEnv } from './runtime-env.js';

const EMPTY_DEPENDENCIES = Object.freeze({});

export const BUDDIES_COLLECTOR_CRON = '* * * * *';

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

  const scheduledAt = Number(controller?.scheduledTime) || Date.now();
  const collect = dependencies.collectRawChannel || collectRawChannel;
  const collectionDependencies = {
    ...(dependencies.collection || EMPTY_DEPENDENCIES),
    ingestRawCollection: dependencies.ingestRawCollection || ingestRawCollection,
  };
  try {
    const collection = await collect(
      rawCollectorEnv(env),
      collectionDependencies,
    );
    return {
      collected: true,
      scheduled_at: scheduledAt,
      ...(collection && typeof collection === 'object' ? collection : {}),
    };
  } catch (error) {
    console.error(JSON.stringify({
      event: 'buddies_collection_failed',
      scheduled_at: scheduledAt,
      error: sanitizeFailureDetail(error?.message || error),
    }));
    throw error;
  }
}

export default {
  scheduled: runBuddiesCollectorScheduled,
};
