import { browserSource } from '../site/tests/helpers/dashboard-source.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';


test('active history endpoint owns ranking without a legacy implementation', () => {
  const history = readFileSync(new URL('../site/functions/api/history.js', import.meta.url), 'utf8');
  const ranking = readFileSync(new URL('../site/functions/lib/history-ranking.js', import.meta.url), 'utf8');
  const legacyUrl = new URL('../site/functions/lib/history-legacy.mjs', import.meta.url);

  assert.match(history, /\.\.\/lib\/history-ranking\.js/);
  assert.match(ranking, /export async function loadRanking/);
  assert.match(ranking, /ranking_summary/);
  assert.match(ranking, /chart_hosts/);
  assert.equal(existsSync(legacyUrl), false);
});

test('history client exposes only current canonical modes', () => {
  const source = browserSource('history/history-lite.js');

  for (const mode of ['daily', 'weekly', 'monthly', 'broadcasts']) {
    assert.match(source, new RegExp(`${mode}:`));
  }
  assert.doesNotMatch(source, /\btracks:|再生曲一覧|TRACK_COLUMNS|trackDate|trackWeekMode/);
  assert.match(source, /CACHE_PREFIX = 'sh\.history\.v3:'/);
});
