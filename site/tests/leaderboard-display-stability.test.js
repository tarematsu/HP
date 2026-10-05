import { browserSource } from './helpers/dashboard-source.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const history = browserSource('history/history-lite.js');
const sharedLayout = readFileSync(new URL('../public/pages-layout.css', import.meta.url), 'utf8');
const chartStability = readFileSync(new URL('../public/history/history-chart-stability.js', import.meta.url), 'utf8');

test('compact featured ranking widths do not override the all-host table', () => {
  assert.match(sharedLayout, /table\.compact-columns:not\(\.all-host-ranking-table\)[\s\S]*min-width:\s*760px/);
  assert.match(sharedLayout, /table\.all-host-ranking-table\.compact-columns[\s\S]*min-width:\s*980px/);
  assert.doesNotMatch(history, /RANKING_COLUMNS|mode === 'ranking'/);
  assert.doesNotMatch(history, /#historyView \.table-wrap table\.compact-columns th:nth-child\(1\)/);
});

test('refresh keeps an already stable history chart visible until replacement paint completes', () => {
  assert.match(chartStability, /function hasStablePaint\(\)/);
  assert.match(chartStability, /if \(!hasStablePaint\(\)\) conceal\(\);/);
  assert.match(chartStability, /let paintedMode = ''/);
  assert.match(chartStability, /if \(nextMode !== paintedMode\) conceal\(nextMode\)/);
  assert.match(chartStability, /nextMode === 'broadcasts'[\s\S]*prepareBroadcastCanvas\(\)/);
});
