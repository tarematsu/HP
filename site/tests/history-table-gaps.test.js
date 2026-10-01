import test from 'node:test';
import assert from 'node:assert/strict';

import {
  historyGapLabel,
  isMissingHistoryValues,
} from '../public/history/history-table-gaps.js';

test('history missing values require every data cell to be missing', () => {
  assert.equal(isMissingHistoryValues(['—', '—', '-']), true);
  assert.equal(isMissingHistoryValues(['—', '0', '—']), false);
  assert.equal(isMissingHistoryValues([]), false);
});

test('history gap label summarizes descending period rows chronologically', () => {
  assert.equal(
    historyGapLabel(['2026-06-22', '2026-06-21', '2026-06-20']),
    '欠測 2026-06-20〜2026-06-22（3期間）',
  );
  assert.equal(historyGapLabel(['2026-06-22']), '欠測 2026-06-22（1期間）');
});
