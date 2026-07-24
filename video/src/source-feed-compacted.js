import { maybeCleanupCollectionRuns } from './d1-compaction.js';
import { publishFeedSnapshot, refreshFeedSnapshot } from './feed-snapshot.js';
import { rebuildPlaybackFeed } from './playback-feed-sync.js';

const COORDINATOR_NAME = 'global';
const FINALIZE_PATH = '/video-feed-finalize';
const REFRESH_PATH = '/video-feed-refresh';
const STAGE_PATH = '/video-feed-stage';

function coordinatorStub(env) {
  const namespace = env?.SCHEDULER_COORDINATOR;
  return namespace ? namespace.get(namespace.idFromName(COORDINATOR_NAME)) : null;
}

function replacementItems(options) {
  if (Array.isArray(options?.replaceItems)) return options.replaceItems;
  if (Array.isArray(options?.desiredItems)) return options.desiredItems;
  return undefined;
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
    replaceItems: replacementItems(options),
    mergeItems: Array.isArray(options.mergeItems) ? options.mergeItems : undefined,
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
  const replaceItems = replacementItems(options);
  const mergeItems = Array.isArray(options.mergeItems) ? options.mergeItems : undefined;
  const stub = coordinatorStub(env);
  if (stub) {
    const response = await stub.fetch(`https://scheduler.internal${FINALIZE_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        capturedAt,
        groupKey: typeof options.groupKey === 'string' ? options.groupKey : null,
        replaceItems: replaceItems || null,
        mergeItems: mergeItems || null
      })
    });
    if (!response.ok) {
      throw new Error(`video feed coordinator failed: HTTP ${response.status}`);
    }
    const body = await response.json();
    return Math.max(0, Number(body?.count || 0));
  }

  const count = await synchronizeCompactedFeed(env, capturedAt, {
    replaceItems: options.groupKey ? undefined : replaceItems,
    mergeItems: options.groupKey ? replaceItems : mergeItems,
    lock: true
  });
  await maybeCleanupCollectionRuns(env.DB || env);
  return count;
}

export async function stageCompactedFeedCandidates(env, items) {
  const mergeItems = Array.isArray(items) ? items : [];
  if (!mergeItems.length) return 0;
  const stub = coordinatorStub(env);
  if (!stub) return finalizeCompactedFeed(env, undefined, { mergeItems });
  const response = await stub.fetch(`https://scheduler.internal${STAGE_PATH}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mergeItems })
  });
  if (!response.ok) {
    throw new Error(`video feed staging coordinator failed: HTTP ${response.status}`);
  }
  const body = await response.json();
  return Math.max(0, Number(body?.candidateCount || 0));
}

export async function refreshCompactedFeedSnapshot(
  env,
  capturedAt = new Date().toISOString()
) {
  const stub = coordinatorStub(env);
  if (stub) {
    const response = await stub.fetch(`https://scheduler.internal${REFRESH_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ capturedAt })
    });
    if (!response.ok) {
      throw new Error(`video feed refresh coordinator failed: HTTP ${response.status}`);
    }
    const body = await response.json();
    return Math.max(0, Number(body?.count || 0));
  }
  return refreshFeedSnapshot(env, capturedAt);
}
