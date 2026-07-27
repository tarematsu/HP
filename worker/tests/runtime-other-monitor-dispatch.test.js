import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { runRuntimeQueue } from '../src/runtime-queue.js';

const actionsRunner = readFileSync(
  new URL('../scripts/run-runtime-offline-maintenance-actions.mjs', import.meta.url),
  'utf8',
);
const runtimeConfig = JSON.parse(readFileSync(
  new URL('../wrangler.runtime.jsonc', import.meta.url),
  'utf8',
));

test('stream prediction is owned by the bounded offline Actions runner', () => {
  assert.match(actionsRunner, /runStreamGoalPrediction/);
  assert.match(actionsRunner, /STREAM_GOAL_PREDICTION_INTERVAL_MS: 30 \* 60_000/);
  assert.match(actionsRunner, /runtime offline maintenance deadline exceeded/);
  assert.equal(Object.hasOwn(runtimeConfig.vars, 'STREAM_GOAL_PREDICTION_INTERVAL_MS'), false);
  assert.equal(runtimeConfig.triggers, undefined);
});

test('unknown runtime queue messages retry without loading a legacy monitor', async () => {
  const calls = [];
  const originalError = console.error;
  console.error = () => {};
  try {
    await runRuntimeQueue({ messages: [{
      body: { message_type: 'retired-monitor-task' },
      ack() { calls.push('ack'); },
      retry(options) { calls.push(['retry', options]); },
    }] }, {}, {});
  } finally {
    console.error = originalError;
  }
  assert.deepEqual(calls, [['retry', { delaySeconds: 60 }]]);
});
