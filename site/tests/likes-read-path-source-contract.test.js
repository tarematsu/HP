import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const endpoint = readFileSync(new URL('../functions/api/track-history.js', import.meta.url), 'utf8');

test('likes endpoint does not invoke ranking repair writes on request', () => {
  assert.match(endpoint, /loadTrackRankingReadOnly/);
  assert.match(endpoint, /read_path: 'read_only'/);
  assert.doesNotMatch(endpoint, /persistRecoveredRanking|\.run\(\)/);
});
