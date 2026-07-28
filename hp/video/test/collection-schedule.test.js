import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  LIVENESS_CRON,
  LIVENESS_INTERVAL_SECONDS,
  LIVENESS_JOB_NAME,
} from '../src/liveness-schedule.js';
import { MANUAL_IMPORT_QUEUE_NAME } from '../src/manual-import-queue.js';

const wrangler = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
const gatewayWrangler = JSON.parse(await readFile(
  new URL('../../cloud/wrangler.jsonc', import.meta.url),
  'utf8'
));
const entryCore = await readFile(new URL('../src/entry-core.js', import.meta.url), 'utf8');

test('private video deployment uses alarm liveness and owns manual import queues', () => {
  assert.equal(wrangler.triggers, undefined);
  assert.deepEqual(gatewayWrangler.triggers?.crons, []);
  assert.equal(LIVENESS_JOB_NAME, 'video_liveness');
  assert.equal(LIVENESS_INTERVAL_SECONDS, 60 * 60);
  assert.equal(LIVENESS_CRON, '0 * * * *');
  assert.deepEqual(wrangler.queues?.producers, [{
    binding: 'MANUAL_IMPORT_QUEUE',
    queue: MANUAL_IMPORT_QUEUE_NAME
  }]);
  assert.equal(wrangler.queues?.consumers?.[0]?.queue, MANUAL_IMPORT_QUEUE_NAME);
  assert.equal(wrangler.queues?.consumers?.[0]?.max_batch_size, 1);
  assert.equal(wrangler.queues?.consumers?.[0]?.max_concurrency, 1);
  assert.equal(gatewayWrangler.queues, undefined);
});

test('automatic source collection remains explicitly disabled', () => {
  assert.match(entryCore, /async queue\(batch, env\)/);
  assert.doesNotMatch(entryCore, /MANUAL_IMPORT_CRON/);
  assert.match(entryCore, /scheduled-collection-disabled/);
  assert.doesNotMatch(entryCore, /runScheduledCollectionGroup\(/);
});

test('manual collect-all remains the explicit collection entry point', () => {
  assert.match(entryCore, /(?:url\.)?pathname === '\/api\/admin\/collect-all'/);
  assert.match(entryCore, /runAllScheduledCollections\(env\)/);
});
