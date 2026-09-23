import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const cleanup = readFileSync(new URL('../public/history/history-table-cleanup.js', import.meta.url), 'utf8');
const chartStability = readFileSync(new URL('../public/history/history-chart-stability.js', import.meta.url), 'utf8');

test('compact featured ranking widths do not override the seven-column all-host table', () => {
  assert.match(cleanup, /table\.compact-columns:not\(\.all-host-ranking-table\)/);
  assert.doesNotMatch(
    cleanup,
    /#historyView \.table-wrap table\.compact-columns th:nth-child\(1\)/,
  );
});

test('refresh keeps an already stable history chart visible until replacement paint completes', () => {
  assert.match(chartStability, /function hasStablePaint\(\)/);
  assert.match(chartStability, /if \(!hasStablePaint\(\)\) conceal\(\);/);
  assert.match(chartStability, /let paintedMode = ''/);
  assert.match(chartStability, /nextMode && nextMode !== paintedMode/);
});
