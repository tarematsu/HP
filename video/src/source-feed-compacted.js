import { syncCompactedFeedInDatabase } from './compacted-feed-sql.js';
import { ensureDbIndexes } from './db-indexes.js';
import {
  ensureD1Compaction,
  maybeCleanupCollectionRuns,
  withPlaybackFeedFinalization
} from './d1-compaction.js';
import { refreshStatusVideoCounts } from './status-counts.js';

async function serializedFeedContentHash(contentJson) {
  const bytes = new TextEncoder().encode(String(contentJson || '[]'));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((part) => part.toString(16).padStart(2, '0'))
    .join('');
}

export async function synchronizeCompactedFeed(env, capturedAt = new Date().toISOString()) {
  const db = env.DB || env;
  await Promise.all([ensureDbIndexes(db), ensureD1Compaction(db)]);

  return withPlaybackFeedFinalization(db, async () => {
    const synchronized = await syncCompactedFeedInDatabase(db, capturedAt);
    const hash = await serializedFeedContentHash(synchronized.contentJson);
    return {
      value: synchronized.rowCount,
      contentHash: hash,
      rowCount: synchronized.rowCount,
      updatedAt: capturedAt
    };
  });
}

export async function finalizeCompactedFeed(env, capturedAt = new Date().toISOString()) {
  const db = env.DB || env;
  const count = await synchronizeCompactedFeed(db, capturedAt);
  await refreshStatusVideoCounts(db, capturedAt);
  await maybeCleanupCollectionRuns(db);
  return count;
}
