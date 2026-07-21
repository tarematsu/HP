import {
  createOverallCollectionGuard,
  OVERALL_COLLECTION_TIMEOUT_MS,
  SOURCE_TIMEOUTS_MS
} from './collection-guardrails.js';
import {
  clearCollectionContext,
  setCollectionContext
} from './collection-context.js';
import { COLLECTION_CRON } from './scheduled-collection.js';
import { finalizeCompactedFeed } from './source-feed-compacted.js';

export { COLLECTION_CRON };
export const LEGACY_SHARED_CRON = COLLECTION_CRON;

const SOURCE_KEYS = ['sourceA', 'sourceB', 'sourceC', 'sourceD', 'sourceE'];

export function applyUnifiedScheduleToStatus(data) {
  const result = data && typeof data === 'object' ? data : {};
  result.schedules = Object.fromEntries(SOURCE_KEYS.map((key) => [key, COLLECTION_CRON]));
  result.collectionTimeouts = {
    overallMs: OVERALL_COLLECTION_TIMEOUT_MS,
    perSourceMs: SOURCE_TIMEOUTS_MS
  };

  if (result.sites && typeof result.sites === 'object') {
    for (const key of SOURCE_KEYS) {
      if (result.sites[key]) result.sites[key].schedule = COLLECTION_CRON;
    }
  }

  const timingRows = Object.values(result.scheduleTimings || {});
  const sourceKeys = [...new Set(timingRows.flatMap((row) => row?.siteKeys || []))];
  const mergedTiming = timingRows.reduce((merged, row) => {
    merged.measuredSites += Number(row?.measuredSites || 0);
    merged.collectionDurationMs += Number(row?.collectionDurationMs || 0);
    merged.databaseDurationMs += Number(row?.databaseDurationMs || 0);
    merged.sequentialTotalDurationMs += Number(row?.sequentialTotalDurationMs || 0);
    return merged;
  }, {
    siteKeys: sourceKeys,
    measuredSites: 0,
    collectionDurationMs: 0,
    databaseDurationMs: 0,
    sequentialTotalDurationMs: 0,
    allSitesMeasured: false
  });
  mergedTiming.allSitesMeasured = sourceKeys.length > 0
    && mergedTiming.measuredSites === sourceKeys.length;
  result.scheduleTimings = { [COLLECTION_CRON]: mergedTiming };

  return result;
}

async function runWorkerCron(worker, controller, env, cron, signal, options) {
  let task = Promise.resolve();
  const delegatedContext = {
    waitUntil(value) {
      task = Promise.resolve(value);
    }
  };
  await worker.scheduled({ ...controller, ...options, cron, signal }, env, delegatedContext);
  await task;
}

export async function runUnifiedCollection(
  worker,
  controller,
  env,
  timeoutMs = OVERALL_COLLECTION_TIMEOUT_MS
) {
  const guard = createOverallCollectionGuard(timeoutMs);
  const options = {
    deferFeedMaintenance: true,
    collectionSeenKeys: new Set()
  };
  setCollectionContext(env, options);

  try {
    await runWorkerCron(worker, controller, env, COLLECTION_CRON, guard.signal, options);
  } finally {
    try {
      if (env?.DB) await finalizeCompactedFeed(env);
    } finally {
      clearCollectionContext(env);
      guard.dispose();
    }
  }
}
