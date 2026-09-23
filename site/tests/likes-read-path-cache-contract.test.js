import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const endpoint = readFileSync(new URL('../functions/api/track-history.js', import.meta.url), 'utf8');

test('likes metadata is served entirely from the materialized status payload', () => {
  assert.match(endpoint, /model_key='track-history-status'/);
  assert.match(endpoint, /loadTrackHistoryStatus/);
  assert.match(endpoint, /rankingFromStatus/);
  assert.doesNotMatch(endpoint, /cachedRankingMetadata|TRACK_RANKING_SQL|TRACK_RANKING_SUMMARY_SQL|sh_track_ranking_current/);
});
