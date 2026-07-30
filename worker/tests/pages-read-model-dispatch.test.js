import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { dueVariantKeys } from '../scripts/run-pages-read-model-actions.mjs';

const runner = readFileSync(
  new URL('../scripts/run-pages-read-model-actions.mjs', import.meta.url),
  'utf8',
);
const workflow = readFileSync(
  new URL('../../.github/workflows/run-pages-read-model-rebuild.yml', import.meta.url),
  'utf8',
);
const runtime = JSON.parse(readFileSync(
  new URL('../wrangler.runtime.jsonc', import.meta.url),
  'utf8',
));
const cycleStart = Date.UTC(2026, 6, 18);
const MINUTE = 60_000;

test('Actions applies contract-driven six-hour and daily read-model cadences', () => {
  assert.deepEqual([...dueVariantKeys(cycleStart + 4 * MINUTE)], [
    'dashboard',
    'history:daily',
    'history:weekly',
    'history:monthly',
    'history:broadcasts',
    'host-history:summary',
  ]);
  assert.deepEqual([...dueVariantKeys(cycleStart + 19 * MINUTE)], ['dashboard']);
  assert.deepEqual([...dueVariantKeys(cycleStart + 64 * MINUTE)], ['dashboard']);
  assert.deepEqual([...dueVariantKeys(cycleStart + 184 * MINUTE)], ['dashboard']);
  assert.deepEqual([...dueVariantKeys(cycleStart + 364 * MINUTE)], [
    'dashboard',
    'history:daily',
    'history:weekly',
    'history:monthly',
    'history:broadcasts',
  ]);
  assert.doesNotMatch(runner, /PAGES_CYCLE_MINUTES|cycleSlotKey|pagesSixHourTask/);
});

test('track-history read-model generation is absent from scheduled Actions', () => {
  assert.match(runner, /export async function runPagesReadModelActions/);
  assert.doesNotMatch(runner, /runSplitTrackHistoryCycleStep|DEFAULT_TRACK_HISTORY_STEPS|MAX_TRACK_HISTORY_STEPS/);
  assert.doesNotMatch(runner, /trackHistoryPublishedThisRun|dueKeys\.add\('track-history'\)/);
  assert.match(runner, /track-history-read-model-disabled/);
  assert.doesNotMatch(workflow, /PAGES_READ_MODEL_MAX_STEPS|Rebuild track history|track-history generation/);
});

test('workflow keeps independent scheduled opportunities without Worker queues', () => {
  assert.doesNotMatch(workflow, /workflow_run:/);
  assert.match(workflow, /cron: '26,56 \* \* \* \*'/);
  assert.match(workflow, /ref: \$\{\{ github\.sha \}\}/);
  assert.match(workflow, /Refresh budget-safe read models during D1 budget deferral/);
  assert.match(workflow, /Publish due pages read models/);
  assert.match(workflow, /timeout-minutes: 15/);
  assert.match(workflow, /cancel-in-progress: true/);
  assert.equal(runtime.triggers, undefined);
  assert.equal(runtime.queues.consumers.some(({ queue }) => queue.includes('read-model')), false);
  assert.equal(runtime.queues.producers.some(({ binding }) => binding.includes('READ_MODEL')), false);
});
