import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

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

test('Actions applies tiered read-model cadences instead of a 24-hour minute-slot dispatcher', () => {
  assert.match(runner, /const due = new Set\(\['dashboard'\]\)/);
  assert.match(runner, /minute % 60 === 4[\s\S]*history:daily/);
  assert.match(runner, /minute % 180 === 4[\s\S]*history:weekly[\s\S]*history:broadcasts/);
  assert.match(runner, /minute % 360 === 4[\s\S]*history:monthly/);
  assert.match(runner, /minute % 1440 === 4[\s\S]*host-history:summary/);
  assert.doesNotMatch(runner, /PAGES_CYCLE_MINUTES|cycleSlotKey|pagesSixHourTask/);
});

test('track-history completes inside one bounded Actions process', () => {
  assert.match(runner, /runSplitTrackHistoryCycleStep/);
  assert.match(runner, /while \(steps < maxSteps && Date\.now\(\) < deadlineMs\)/);
  assert.match(runner, /PAGES_READ_MODEL_MAX_STEPS \|\| 1800/);
  assert.match(runner, /PAGES_READ_MODEL_DEADLINE_MS \|\| 12 \* 60_000/);
  assert.match(runner, /track-history-cycle-already-published/);
});

test('workflow runs every fifteen minutes without a Worker cron or read-model Queue', () => {
  assert.match(workflow, /cron: '4,19,34,49 \* \* \* \*'/);
  assert.match(workflow, /timeout-minutes: 15/);
  assert.match(workflow, /cancel-in-progress: true/);
  assert.equal(runtime.triggers, undefined);
  assert.equal(runtime.queues.consumers.some(({ queue }) => queue.includes('read-model')), false);
  assert.equal(runtime.queues.producers.some(({ binding }) => binding.includes('READ_MODEL')), false);
});
