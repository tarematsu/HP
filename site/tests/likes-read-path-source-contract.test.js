import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const endpoint = readFileSync(new URL('../functions/api/track-history.js', import.meta.url), 'utf8');

test('likes endpoint does not invoke ranking rebuild or repair writes on request', () => {
  assert.match(endpoint, /loadTrackHistoryStatus/);
  assert.match(endpoint, /read_path: 'track-history-status-read-model'/);
  assert.match(endpoint, /model_key='track-history-status'/);
  assert.doesNotMatch(endpoint, /loadTrackRankingReadOnly|TRACK_RANKING_SQL|sh_track_ranking_current|persistRecoveredRanking|\.run\(\)/);
});
