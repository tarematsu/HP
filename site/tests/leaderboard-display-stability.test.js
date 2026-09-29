import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const history = readFileSync(new URL('../public/history/history-lite.js', import.meta.url), 'utf8');
const sharedLayout = readFileSync(new URL('../public/pages-layout.css', import.meta.url), 'utf8');
const chartStability = readFileSync(new URL('../public/history/history-chart-stability.js', import.meta.url), 'utf8');

test('compact featured ranking widths do not override the all-host table', () => {
  assert.match(sharedLayout, /table\.compact-columns:not\(\.all-host-ranking-table\)[\s\S]*min-width:\s*760px !important/);
  assert.match(sharedLayout, /table\.all-host-ranking-table\.compact-columns[\s\S]*min-width:\s*980px !important/);
  assert.match(history, /classList\.toggle\('compact-columns', mode === 'ranking'\)/);
  assert.doesNotMatch(history, /#historyView \.table-wrap table\.compact-columns th:nth-child\(1\)/);
});

test('refresh keeps an already stable history chart visible until replacement paint completes', () => {
  assert.match(chartStability, /function hasStablePaint\(\)/);
  assert.match(chartStability, /if \(!hasStablePaint\(\)\) conceal\(\);/);
  assert.match(chartStability, /let paintedMode = ''/);
  assert.match(chartStability, /if \(nextMode !== paintedMode\) conceal\(nextMode\)/);
  assert.match(chartStability, /nextMode === 'broadcasts'[\s\S]*prepareBroadcastCanvas\(\)/);
});
