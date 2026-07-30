import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function source(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

function runtimeConfig() {
  return JSON.parse(source('../wrangler.runtime.jsonc'));
}

test('runtime keeps only immediate enrichment Queue boundaries', () => {
  const config = runtimeConfig();
  const enrichment = source('../src/minute-enrichment-optimized-entry.js');
  const metadata = source('../src/track-metadata-entry.js');

  for (const queue of ['stationhead-minute-enrichment', 'stationhead-track-metadata']) {
    const consumer = config.queues.consumers.find((item) => item.queue === queue);
    assert.equal(consumer.max_batch_size, 1, queue);
    assert.equal(consumer.max_concurrency, 1, queue);
  }
  assert.equal(config.queues.consumers.some(({ queue }) => queue.includes('read-model')), false);
  assert.equal(config.queues.producers.some(({ binding }) => binding.includes('READ_MODEL')), false);

  assert.match(enrichment, /TRACK_METADATA_MESSAGE_TYPE/);
  assert.match(enrichment, /processTrackMetadataTask/);
  assert.match(enrichment, /for \(const message of messages\)/);
  assert.doesNotMatch(enrichment, /Promise\.all\(messages|pagesModulePromise|runPagesReadModelCron|PAGES_PUBLICATION_QUEUE_NAME/);
  assert.match(metadata, /from '\.\/committed-metadata-enrichment\.js'/);
});

test('Pages summary materialization is owned by the bounded independent Actions runner', () => {
  const workflow = source('../../.github/workflows/run-pages-read-model-rebuild.yml');
  const runner = source('../scripts/run-pages-read-model-actions.mjs');
  const responseStore = source('../src/pages-response-r2.js');
  assert.doesNotMatch(workflow, /workflow_run:/);
  assert.match(workflow, /cron: '26,56 \* \* \* \*'/);
  assert.match(workflow, /ref: \$\{\{ github\.sha \}\}/);
  assert.match(workflow, /timeout-minutes: 15/);
  assert.doesNotMatch(workflow, /PAGES_READ_MODEL_MAX_STEPS|Rebuild track history/);
  assert.match(workflow, /Refresh budget-safe read models during D1 budget deferral/);
  assert.match(workflow, /cancel-in-progress: true/);
  assert.match(runner, /PAGES_READ_MODEL_DEADLINE_MS/);
  assert.match(runner, /pagesActionsR2ResponseKey/);
  assert.match(runner, /track-history-read-model-disabled/);
  assert.doesNotMatch(runner, /runSplitTrackHistoryCycleStep/);
  assert.match(responseStore, /pages-response\/actions-v2/);
  assert.match(responseStore, /pages-response\/actions-v1/);
});
