import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../functions/lib/d1-optimized-ingest.js', import.meta.url), 'utf8');

test('queue likes use canonical current and observation tables without mirroring item rows', () => {
  assert.doesNotMatch(source, /queueItemLikeUpdateStatements/);
  assert.doesNotMatch(source, /SET bite_count=\?/);
  assert.match(source, /const LIKE_CURRENT_SQL/);
  assert.match(source, /const LIKE_OBSERVATION_SQL/);
  assert.match(source, /likeWriteStatements/);
});
