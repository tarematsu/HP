import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const shell = readFileSync(new URL('../public/history-shell.js', import.meta.url), 'utf8');
const compact = readFileSync(new URL('../public/history/history-ranking-compact-layout.js', import.meta.url), 'utf8');

test('leaderboard uses QQ-style update metadata above chart and data', () => {
  assert.match(shell, /history-ranking-compact-layout\.js/);
  assert.match(shell, /id="rankingCompactMeta" class="regional-chart-meta"/);
  assert.match(shell, /更新日時 <strong id="rankingUpdatedAt">-<\/strong>/);
  assert.match(shell, /更新周期 <strong>毎日00:00<\/strong>/);
  assert.match(compact, /detail\.data\?\.materialized_at/);
  assert.match(compact, /timeZone: 'Asia\/Tokyo'/);
});

test('leaderboard compact mode leaves only metadata, chart, and data surface visible', () => {
  for (const id of ['controls', 'notice', 'summaryCards', 'csv', 'rankingWeeklyPanel']) {
    assert.match(compact, new RegExp(`['"]${id}['"]`));
  }
  assert.match(compact, /node\.style\.display = ranking \? 'none' : ''/);
  assert.doesNotMatch(compact, /chartPanel.*display.*none/);
  assert.doesNotMatch(compact, /tbody.*display.*none/);
});
