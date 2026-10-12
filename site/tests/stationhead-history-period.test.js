import assert from 'node:assert/strict';
import test from 'node:test';

import { historyPeriodLabels } from '../public/stationhead/history-view.js';

test('history period labels stay compact across years without losing the full range', () => {
  assert.deepEqual(historyPeriodLabels([
    { period_key: '2024-06-18' },
    { period_key: '2026-10-11' },
  ]), {
    text: '24/6/18〜26/10/11',
    title: '2024-06-18〜2026-10-11',
  });
});

test('history period labels omit repeated year and month parts', () => {
  assert.deepEqual(historyPeriodLabels([
    { period_key: '2026-10-01' },
    { period_key: '2026-10-11' },
  ]), {
    text: '26/10/1〜11',
    title: '2026-10-01〜2026-10-11',
  });
});

test('history period labels preserve the empty state', () => {
  assert.deepEqual(historyPeriodLabels([]), { text: '—', title: '—' });
});
