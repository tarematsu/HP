import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import { liveSummarySql } from '../site/functions/lib/history-summary.js';

test('live summary SQL aggregates rows inside D1', () => {
  const sql = liveSummarySql('weekly');
  assert.match(sql, /WITH prepared AS/);
  assert.match(sql, /COUNT\(\*\) AS sample_count/);
  assert.match(sql, /GROUP BY period_key/);
  assert.doesNotMatch(sql, /LIMIT 100000/);
});

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
  const source = readFileSync(
    new URL('../site/public/history/history-lite.js', import.meta.url),
    'utf8',
  );

  for (const mode of ['daily', 'weekly', 'monthly', 'ranking', 'broadcasts']) {
    assert.match(source, new RegExp(`${mode}:`));
  }
  assert.doesNotMatch(source, /tracks:|再生曲一覧|TRACK_COLUMNS|trackDate|trackWeekMode/);
  assert.match(source, /CACHE_PREFIX = 'sh\.history\.v3:'/);
});
