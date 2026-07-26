import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(new URL('../.github/workflows/run-pages-read-model-rebuild.yml', import.meta.url), 'utf8');
const runner = readFileSync(new URL('../worker/scripts/run-pages-read-model-actions.mjs', import.meta.url), 'utf8');
const runtime = JSON.parse(readFileSync(new URL('../worker/wrangler.runtime.jsonc', import.meta.url), 'utf8'));

test('pages read models rebuild frequently in one bounded Actions job', () => {
  assert.match(workflow, /cron: '4,19,34,49 \* \* \* \*'/);
  assert.match(workflow, /group: pages-read-model-rebuild/);
  assert.match(workflow, /cancel-in-progress: true/);
  assert.match(workflow, /timeout-minutes: 15/);
  assert.match(workflow, /run-pages-read-model-actions\.mjs/);
  assert.match(runner, /runSplitTrackHistoryCycleStep/);
  assert.match(runner, /while \(steps < maxSteps && Date\.now\(\) < deadlineMs\)/);
  assert.match(runner, /PAGES_READ_MODEL_MAX_STEPS/);
  assert.match(runner, /PAGES_READ_MODEL_DEADLINE_MS/);
  assert.match(runner, /d1', 'execute'.*--remote/s);
  assert.equal(runtime.vars.PAGES_TRACK_HISTORY_CYCLE_ENABLED, false);
});
