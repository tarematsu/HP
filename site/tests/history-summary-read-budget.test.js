import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { currentSummaryPeriodStart } from '../../packages/sh-shared/history-summary-contract.mjs';

const NOW = Date.UTC(2026, 6, 19, 12, 34, 56);
const history = readFileSync(new URL('../functions/api/history.js', import.meta.url), 'utf8');
const materialized = readFileSync(
  new URL('../../packages/sh-shared/materialized-history-summary.mjs', import.meta.url),
  'utf8',
);

test('history period boundaries use UTC', () => {
  assert.equal(currentSummaryPeriodStart('daily', NOW), Date.UTC(2026, 6, 19));
  assert.equal(currentSummaryPeriodStart('weekly', NOW), Date.UTC(2026, 6, 13));
  assert.equal(currentSummaryPeriodStart('monthly', NOW), Date.UTC(2026, 6, 1));
});

test('Pages history reuses the shared materialized summary and never owns raw history SQL', () => {
  assert.match(history, /loadMaterializedSummary/);
  assert.doesNotMatch(history, /sh_channel_snapshots|sh_minute_facts|liveSummarySql|loadSummaryWithLive/);
  assert.match(materialized, /FROM \$\{table\}/);
  assert.doesNotMatch(materialized, /sh_channel_snapshots|sh_minute_facts/);
});
