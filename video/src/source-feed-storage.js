import { seenSessionStart } from './source-feed-time.js';
import {
  countInsertedRows,
  upsertVideoItemsStatement,
  VIDEO_STORAGE_BATCH_SIZE,
  videoItemPayloads
} from './video-storage-statements.js';

export function sourceFeedPayloads(items) {
  return videoItemPayloads(items);
}

function changedRows(result) {
  const metaChanges = Number(result?.meta?.changes || 0);
  const returnedChanges = Array.isArray(result?.results) ? result.results.length : 0;
  return Math.max(Number.isFinite(metaChanges) ? metaChanges : 0, returnedChanges);
}

export async function saveSourceFeedItems(db, items, capturedAt) {
  let inserted = 0;
  let changed = 0;
  const payloads = sourceFeedPayloads(items);
  const sessionStart = seenSessionStart(capturedAt);
  for (let offset = 0; offset < payloads.length; offset += VIDEO_STORAGE_BATCH_SIZE) {
    const statements = payloads
      .slice(offset, offset + VIDEO_STORAGE_BATCH_SIZE)
      .map((payload) => upsertVideoItemsStatement(db, payload, capturedAt, {
        conditional: true,
        returningInserted: true,
        sessionStart
      }));
    const results = await db.batch(statements);
    for (const result of results) {
      inserted += countInsertedRows(result);
      changed += changedRows(result);
    }
  }
  return { inserted, changed, chunks: payloads.length };
}
