import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sourceFeedCompacted = readFileSync(
  new URL('../src/source-feed-compacted.js', import.meta.url),
  'utf8'
);
const runtimeBugfixMigration = readFileSync(
  new URL('../../cloud/migrations/202607240300_d1_runtime_bugfixes.sql', import.meta.url),
  'utf8'
);

test('compacted feed finalization relies on trigger-maintained status counts', () => {
  assert.doesNotMatch(sourceFeedCompacted, /refreshStatusVideoCounts/);
  assert.match(runtimeBugfixMigration, /CREATE TRIGGER status_counts_on_ranking_insert/);
  assert.match(runtimeBugfixMigration, /CREATE TRIGGER status_counts_on_ranking_delete/);
  assert.match(runtimeBugfixMigration, /CREATE TRIGGER status_counts_on_video_update/);
});
