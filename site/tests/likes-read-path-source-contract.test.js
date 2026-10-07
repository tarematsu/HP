import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const endpoint = readFileSync(new URL('../functions/api/track-history.js', import.meta.url), 'utf8');
const readModelService = readFileSync(new URL('../functions/lib/pages-read-model-service.js', import.meta.url), 'utf8');

test('likes endpoint does not invoke ranking rebuild, D1 reads, or repair writes on request', () => {
  assert.match(endpoint, /fetchPagesReadModel/);
  assert.match(endpoint, /api: true/);
  assert.match(readModelService, /PAGES_READ_MODEL_SERVICE/);
  assert.match(readModelService, /service\.fetch/);
  assert.doesNotMatch(endpoint, /MINUTE_DB|loadTrackRankingReadOnly|TRACK_RANKING_SQL|sh_track_ranking_current|persistRecoveredRanking|\.prepare\(|\.run\(\)/);
});
