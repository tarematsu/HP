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

test('Actions applies tiered read-model cadences instead of a 24-hour minute-slot dispatcher', () => {
  assert.deepEqual([...dueVariantKeys(cycleStart + 4 * 60_000)], [
    'dashboard',
    'history:daily',
    'history:weekly',
    'history:broadcasts',
    'history:monthly',
    'host-history:summary',
    'track-history',
  ]);
  assert.deepEqual([...dueVariantKeys(cycleStart + 19 * 60_000)], ['dashboard']);
  assert.deepEqual([...dueVariantKeys(cycleStart + 184 * 60_000)], [
    'dashboard',
    'history:daily',
    'history:weekly',
    'history:broadcasts',
  ]);
  assert.doesNotMatch(runner, /PAGES_CYCLE_MINUTES|cycleSlotKey|pagesSixHourTask/);
});

test('track-history advances in bounded Actions slices and publishes R2 only when complete', () => {
  assert.match(runner, /export async function runPagesReadModelActions/);
  assert.match(runner, /runSplitTrackHistoryCycleStep/);
  assert.match(runner, /DEFAULT_TRACK_HISTORY_STEPS = 4/);
  assert.match(runner, /MAX_TRACK_HISTORY_STEPS = 16/);
  assert.match(runner, /while \(steps < maxSteps && Number\(clock\(\)\) < deadlineMs\)/);
  assert.match(runner, /pages_read_model_actions_deferred/);
  assert.match(runner, /track_history_deferred/);
  assert.match(runner, /if \(complete\)/);
  assert.match(runner, /trackHistoryPublishedThisRun/);
  assert.match(runner, /dueKeys\.add\('track-history'\)/);
  assert.match(runner, /process\.env\.PAGES_READ_MODEL_MAX_STEPS/);
  assert.match(runner, /process\.env\.PAGES_READ_MODEL_DEADLINE_MS/);
});

test('workflow keeps scheduled opportunities without duplicate push chaining or Worker queues', () => {
  assert.match(workflow, /workflows: \["Run runtime offline maintenance"\]/);
  assert.match(workflow, /cron: '26,56 \* \* \* \*'/);
  assert.match(workflow, /PAGES_READ_MODEL_MAX_STEPS: '4'/);
  assert.match(workflow, /github\.event\.workflow_run\.conclusion == 'success'/);
  assert.match(workflow, /github\.event\.workflow_run\.event == 'schedule'/);
  assert.doesNotMatch(workflow, /github\.event\.workflow_run\.event == 'push'/);
  assert.match(workflow, /github\.event\.workflow_run\.head_sha \|\| github\.sha/);
  assert.match(workflow, /ignored-chain/);
  assert.match(workflow, /operational/);
  assert.match(workflow, /timeout-minutes: 15/);
  assert.match(workflow, /cancel-in-progress: true/);
  assert.equal(runtime.triggers, undefined);
  assert.equal(runtime.queues.consumers.some(({ queue }) => queue.includes('read-model')), false);
  assert.equal(runtime.queues.producers.some(({ binding }) => binding.includes('READ_MODEL')), false);
});
