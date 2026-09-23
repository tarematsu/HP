import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const endpoint = readFileSync(new URL('../functions/api/track-history.js', import.meta.url), 'utf8');

test('likes metadata reuses the existing materialized status payload', () => {
  assert.match(endpoint, /model_key='track-history-status'/);
  assert.match(endpoint, /cachedRankingMetadata/);
  assert.match(endpoint, /TRACK_RANKING_SQL/);
  assert.match(endpoint, /TRACK_RANKING_SUMMARY_SQL/);
});
