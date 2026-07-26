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
  assert.doesNotMatch(enrichment, /pagesModulePromise|runPagesReadModelCron|PAGES_PUBLICATION_QUEUE_NAME/);
  assert.match(metadata, /from '\.\/committed-metadata-enrichment\.js'/);
  assert.doesNotMatch(enrichment, /for\s*\(const message of/);
});

test('Pages materialization is owned by the bounded Actions runner', () => {
  const workflow = source('../../.github/workflows/run-pages-read-model-rebuild.yml');
  const runner = source('../scripts/run-pages-read-model-actions.mjs');
  const responseStore = source('../src/pages-response-r2.js');
  assert.match(workflow, /workflows: \["Run runtime offline maintenance"\]/);
  assert.match(workflow, /cron: '19,49 \* \* \* \*'/);
  assert.match(workflow, /github\.event\.workflow_run\.event == 'schedule'/);
  assert.match(workflow, /github\.event\.workflow_run\.head_sha \|\| github\.sha/);
  assert.match(workflow, /timeout-minutes: 15/);
  assert.match(workflow, /cancel-in-progress: true/);
  assert.match(runner, /PAGES_READ_MODEL_DEADLINE_MS/);
  assert.match(runner, /pagesActionsR2ResponseKey/);
  assert.match(responseStore, /pages-response\/actions-v1/);
});
