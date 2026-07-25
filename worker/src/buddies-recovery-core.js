import './fetch-guard.js';

import ingestWorker from './ingest-channel-optimized-entry.js';
import { rawCollectorEnv } from './runtime-env.js';

const EMPTY_DEPENDENCIES = Object.freeze({});

export const BUDDIES_RECOVERY_QUEUE_NAMES = Object.freeze([
  'stationhead-raw-collection',
  'stationhead-ingest-finalize',
  'stationhead-comments',
  'stationhead-buddies-persist',
]);

const BUDDIES_RECOVERY_QUEUE_SET = new Set(BUDDIES_RECOVERY_QUEUE_NAMES);

export async function runBuddiesRecoveryQueue(
  batch,
  env,
  ctx,
  dependencies = EMPTY_DEPENDENCIES,
) {
  const queueName = String(batch?.queue || '');
  if (!BUDDIES_RECOVERY_QUEUE_SET.has(queueName)) {
    throw new Error(`unsupported buddies recovery queue: ${queueName || 'unknown'}`);
  }
  const run = dependencies.runIngestQueue || ingestWorker.queue;
  return run(
    batch,
    rawCollectorEnv(env),
    ctx,
    dependencies.ingest || EMPTY_DEPENDENCIES,
  );
}

export default {
  queue: runBuddiesRecoveryQueue,
};
