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

test('Pages history materialization is isolated in the scheduled collection Worker', () => {
  const workflow = source('../../.github/workflows/run-pages-read-model-rebuild.yml');
  const scheduled = JSON.parse(source('../wrangler.scheduled-collection-jobs.jsonc'));
  const entry = source('../src/scheduled-collection-jobs-entry.js');
  const responseStore = source('../src/pages-response-r2.js');

  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /schedule:|workflow_run:|cron:/);
  assert.match(workflow, /request-pages-read-model-rebuild-actions\.mjs/);
  assert.doesNotMatch(workflow, /run-pages-read-model-actions|run-pages-history-read-model-actions/);

  assert.equal(scheduled.queues.producers.some(({ binding }) => binding === 'HISTORY_READ_MODEL_QUEUE'), true);
  assert.equal(scheduled.queues.consumers.some(({ queue }) => queue === 'pages-history-refresh'), true);
  assert.match(entry, /HISTORY_READ_MODEL_RECOVERY_CRON/);
  assert.match(entry, /refreshLeaderboard[\s\S]*enqueueHistory/);

  assert.match(responseStore, /pages-response\/v1/);
  assert.match(responseStore, /pages-response\/actions-v2/);
  assert.doesNotMatch(responseStore, /pages-response\/actions-v1/);
});
