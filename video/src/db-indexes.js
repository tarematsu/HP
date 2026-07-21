import { ensureDatabaseOnce } from './db-init.js';

// Schema/index creation belongs to versioned D1 migrations. Keeping this
// function preserves the call-site contract without issuing runtime DDL on
// every new Worker isolate.
export function ensureDbIndexes(db) {
  return ensureDatabaseOnce(db, 'db-indexes-migrated-v7', async () => undefined);
}
