import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(new URL('../.github/workflows/run-runtime-offline-maintenance.yml', import.meta.url), 'utf8');
const runner = readFileSync(new URL('../worker/scripts/run-runtime-offline-maintenance-actions.mjs', import.meta.url), 'utf8');
const scheduled = readFileSync(new URL('../worker/src/runtime-scheduled.js', import.meta.url), 'utf8');

test('offline runtime maintenance runs frequently as one bounded Actions job', () => {
  assert.match(workflow, /cron: '3,33 \* \* \* \*'/);
  assert.match(workflow, /cancel-in-progress: true/);
  assert.match(workflow, /timeout-minutes: 15/);
  assert.match(workflow, /run-runtime-offline-maintenance-actions\.mjs/);
});

test('Actions consolidates prediction rollup and retention without Worker queues', () => {
  assert.match(runner, /runStreamGoalPrediction/);
  assert.match(runner, /runRollupMaintenance/);
  assert.match(runner, /pruneOldSnapshots/);
  assert.match(runner, /SNAPSHOT_RETENTION_BATCH_SIZE: 5000/);
  assert.match(runner, /SNAPSHOT_RETENTION_MAX_BATCHES: 100/);
  assert.match(runner, /STREAM_GOAL_PREDICTION_INTERVAL_MS: 30 \* 60_000/);
});

test('runtime cron emits only the realtime raw collection task', () => {
  assert.match(scheduled, /runtimeScheduledMessagesFor\(scheduledAt\)[\s\S]*RAW_COLLECTION_TASK_MESSAGE/);
  assert.match(scheduled, /export function maintenanceCronFor\(\) \{\s*return null;/);
  assert.match(scheduled, /export function minuteRecoveryPollDue\(\) \{\s*return false;/);
  assert.match(scheduled, /export function streamPredictionDue\(\) \{\s*return false;/);
  assert.doesNotMatch(scheduled, /sendBatch\(messages/);
});
