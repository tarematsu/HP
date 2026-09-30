import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const endpoint = readFileSync(new URL('../functions/api/track-history.js', import.meta.url), 'utf8');

test('likes metadata is served entirely through the materialized R2 service', () => {
  assert.match(endpoint, /PAGES_READ_MODEL_SERVICE/);
  assert.match(endpoint, /url\.searchParams\.set\('key', TRACK_HISTORY_MODEL_KEY\)/);
  assert.match(endpoint, /url\.searchParams\.set\('api', '1'\)/);
  assert.match(endpoint, /url\.searchParams\.append\(name, value\)/);
  assert.doesNotMatch(endpoint, /MINUTE_DB|model_key=|cachedRankingMetadata|TRACK_RANKING_SQL|TRACK_RANKING_SUMMARY_SQL|sh_track_ranking_current|\.prepare\(/);
});
