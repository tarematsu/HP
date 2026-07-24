import { maybeCleanupCollectionRuns } from './d1-compaction.js';
import { publishFeedSnapshot } from './feed-snapshot.js';
import { rebuildPlaybackFeed } from './playback-feed-sync.js';

const COORDINATOR_NAME = 'global';
const FINALIZE_PATH = '/video-feed-finalize';

function coordinatorStub(env) {
  const namespace = env?.SCHEDULER_COORDINATOR;
  return namespace ? namespace.get(namespace.idFromName(COORDINATOR_NAME)) : null;
}

export async function synchronizeCompactedFeed(
  env,
  capturedAt = new Date().toISOString(),
  options = {}
) {
  const db = env.DB || env;
  const publishSnapshot = env?.DB && env?.DATA_BUCKET
    ? (rows, hash, generatedAt) => publishFeedSnapshot(env, rows, hash, generatedAt)
    : undefined;
  return rebuildPlaybackFeed(db, capturedAt, {
    desiredItems: options.desiredItems,
    lock: options.lock,
    publishSnapshot
  });
}

export async function finalizeCompactedFeedLocally(
  env,
  capturedAt = new Date().toISOString(),
  options = {}
) {
  const count = await synchronizeCompactedFeed(env, capturedAt, {
    ...options,
    lock: false
  });
  await maybeCleanupCollectionRuns(env.DB || env);
  return count;
}

export async function finalizeCompactedFeed(
  env,
  capturedAt = new Date().toISOString(),
  options = {}
) {
  const stub = coordinatorStub(env);
  if (stub) {
    const response = await stub.fetch(`https://scheduler.internal${FINALIZE_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        capturedAt,
        desiredItems: Array.isArray(options.desiredItems) ? options.desiredItems : null
      })
    });
    if (!response.ok) {
      throw new Error(`video feed coordinator failed: HTTP ${response.status}`);
    }
    const body = await response.json();
    return Math.max(0, Number(body?.count || 0));
  }

  const count = await synchronizeCompactedFeed(env, capturedAt, {
    ...options,
    lock: true
  });
  await maybeCleanupCollectionRuns(env.DB || env);
  return count;
}
