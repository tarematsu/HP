import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const ingest = readFileSync(new URL('../functions/lib/ingest.js', import.meta.url), 'utf8');
const filter = readFileSync(new URL('../functions/lib/d1-queue-like-write-filter.js', import.meta.url), 'utf8');
const optimized = readFileSync(new URL('../functions/lib/d1-optimized-ingest.js', import.meta.url), 'utf8');

test('queue likes use canonical current and observation tables without mirroring item rows', () => {
  assert.match(ingest, /withoutQueueItemLikeMirrors\(env\.DB\)/);
  assert.match(filter, /UPDATE\\s\+sh_queue_items\\s\+SET\\s\+bite_count/);
  assert.match(filter, /changes: 0/);
  assert.match(optimized, /const LIKE_CURRENT_SQL/);
  assert.match(optimized, /const LIKE_OBSERVATION_SQL/);
  assert.match(optimized, /likeWriteStatements/);
});
