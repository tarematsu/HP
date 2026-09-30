import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const endpoint = readFileSync(new URL('../functions/api/track-history.js', import.meta.url), 'utf8');

test('likes endpoint does not invoke ranking rebuild, D1 reads, or repair writes on request', () => {
  assert.match(endpoint, /PAGES_READ_MODEL_SERVICE/);
  assert.match(endpoint, /url\.searchParams\.set\('api', '1'\)/);
  assert.match(endpoint, /service\.fetch/);
  assert.doesNotMatch(endpoint, /MINUTE_DB|loadTrackRankingReadOnly|TRACK_RANKING_SQL|sh_track_ranking_current|persistRecoveredRanking|\.prepare\(|\.run\(\)/);
});
