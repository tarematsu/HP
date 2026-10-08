import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(
  new URL('../.github/workflows/run-pages-read-model-rebuild.yml', import.meta.url),
  'utf8',
);
const scheduledEntry = readFileSync(
  new URL('../worker/src/scheduled-collection-jobs-entry.js', import.meta.url),
  'utf8',
);
const scheduledConfig = JSON.parse(readFileSync(
  new URL('../worker/wrangler.scheduled-collection-jobs.jsonc', import.meta.url),
  'utf8',
));

test('Pages history publication has no Actions budget or scheduled generator path', () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /schedule:|cron:|workflow_run:/);
  assert.doesNotMatch(workflow, /cloudflare-d1-write-guard\.mjs/);
  assert.doesNotMatch(workflow, /D1_ACTIONS_READ_ROWS_PER_DAY_LIMIT/);
  assert.doesNotMatch(workflow, /D1_ACTIONS_WRITE_ROWS_PER_HOUR_LIMIT/);
  assert.doesNotMatch(workflow, /PAGES_READ_MODEL_REUSE_ONLY/);
  assert.doesNotMatch(workflow, /run-pages-history-read-model-actions\.mjs/);
  assert.match(workflow, /request-pages-read-model-rebuild-actions\.mjs/);
});

test('history recovery and publication stay in the Worker Queue boundary', () => {
  assert.match(scheduledEntry, /HISTORY_READ_MODEL_RECOVERY_CRON/);
  assert.match(scheduledEntry, /enqueueChangedHistoryModels/);
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
