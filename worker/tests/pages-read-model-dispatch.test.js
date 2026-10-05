import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(
  new URL('../../.github/workflows/run-pages-read-model-rebuild.yml', import.meta.url),
  'utf8',
);
const requestScript = readFileSync(
  new URL('../scripts/request-pages-read-model-rebuild-actions.mjs', import.meta.url),
  'utf8',
);
const scheduledEntry = readFileSync(
  new URL('../src/scheduled-collection-jobs-entry.js', import.meta.url),
  'utf8',
);
const scheduledConfig = JSON.parse(readFileSync(
  new URL('../wrangler.scheduled-collection-jobs.jsonc', import.meta.url),
  'utf8',
));

test('GitHub Actions read-model workflow is manual recovery only', () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /schedule:|workflow_run:|cron:/);
  assert.match(workflow, /Request canonical Worker rebuild/);
  assert.match(workflow, /request-pages-read-model-rebuild-actions\.mjs/);
  assert.doesNotMatch(workflow, /run-pages-read-model-actions|run-pages-history-read-model-actions/);
  assert.match(requestScript, /\/internal\/read-model\/rebuild/);
});

test('normal history publication is Worker Queue driven with minute recovery', () => {
  assert.match(scheduledEntry, /HISTORY_READ_MODEL_RECOVERY_CRON/);
  assert.match(scheduledEntry, /enqueueChangedHistoryModels/);
  assert.match(scheduledEntry, /refreshLeaderboard[\s\S]*enqueueHistory/);
  assert.equal(
    scheduledConfig.queues.producers.some(({ binding, queue }) =>
      binding === 'HISTORY_READ_MODEL_QUEUE' && queue === 'pages-history-refresh'),
    true,
  );
  assert.equal(
    scheduledConfig.queues.consumers.some(({ queue }) => queue === 'pages-history-refresh'),
    true,
  );
});
