import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { LIVENESS_CRON } from '../src/liveness-schedule.js';
import { MANUAL_IMPORT_QUEUE_NAME } from '../src/manual-import-queue.js';

const wrangler = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
const entryCore = await readFile(new URL('../src/entry-core.js', import.meta.url), 'utf8');

test('deployment schedules only liveness and drives manual imports from a Queue', () => {
  assert.deepEqual(wrangler.triggers?.crons, [LIVENESS_CRON]);
  assert.deepEqual(wrangler.queues?.producers, [{
    binding: 'MANUAL_IMPORT_QUEUE',
    queue: MANUAL_IMPORT_QUEUE_NAME
  }]);
  assert.deepEqual(wrangler.queues?.consumers, [{
    queue: MANUAL_IMPORT_QUEUE_NAME,
    max_batch_size: 1,
    max_batch_timeout: 0,
    max_retries: 5,
    max_concurrency: 1,
    dead_letter_queue: 'videoscraper-manual-imports-dlq'
  }]);
});

test('automatic source collection crons remain explicitly disabled', () => {
  assert.match(entryCore, /controller\.cron === LIVENESS_CRON/);
  assert.match(entryCore, /async queue\(batch, env\)/);
  assert.doesNotMatch(entryCore, /MANUAL_IMPORT_CRON/);
  assert.match(entryCore, /scheduled-collection-disabled/);
  assert.doesNotMatch(entryCore, /runScheduledCollectionGroup\(/);
});

test('manual collect-all remains the explicit collection entry point', () => {
  assert.match(entryCore, /(?:url\.)?pathname === '\/api\/admin\/collect-all'/);
  assert.match(entryCore, /runAllScheduledCollections\(env\)/);
});
