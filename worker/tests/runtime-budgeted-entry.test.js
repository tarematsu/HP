import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  attributedRuntimeEnv,
  dashboardMaterializationDue,
  pagesScheduledDue,
  runBudgetedPagesScheduled,
  runBudgetedRuntimeScheduled,
} from '../src/runtime-budgeted-entry.js';

const MINUTE_MS = 60_000;

test('Pages work runs only for the 15-minute dashboard cadence or variant slots', async () => {
  assert.equal(dashboardMaterializationDue(0, {}), true);
  assert.equal(dashboardMaterializationDue(5 * MINUTE_MS, {}), false);
  assert.equal(dashboardMaterializationDue(15 * MINUTE_MS, {}), true);
  assert.equal(pagesScheduledDue(1 * MINUTE_MS, { PAGES_TRACK_HISTORY_CYCLE_ENABLED: false }), false);
  assert.equal(pagesScheduledDue(35 * MINUTE_MS, { PAGES_TRACK_HISTORY_CYCLE_ENABLED: false }), true);

  const calls = [];
  const dependencies = {
    async runTask() { calls.push('variant'); return 'variant'; },
    async runDashboard() { calls.push('dashboard'); return 'dashboard'; },
  };
  const idle = await runBudgetedPagesScheduled(
    { scheduledTime: 1 * MINUTE_MS },
    { PAGES_TRACK_HISTORY_CYCLE_ENABLED: false },
    dependencies,
  );
  assert.equal(idle.skipped, true);
  await runBudgetedPagesScheduled(
    { scheduledTime: 15 * MINUTE_MS },
    { PAGES_TRACK_HISTORY_CYCLE_ENABLED: false },
    dependencies,
  );
  await runBudgetedPagesScheduled(
    { scheduledTime: 35 * MINUTE_MS },
    { PAGES_TRACK_HISTORY_CYCLE_ENABLED: false },
    dependencies,
  );
  assert.deepEqual(calls, ['dashboard', 'variant']);
});

test('scheduled runtime maintenance is inline and Queue is fallback-only', async () => {
  const calls = [];
  const sent = [];
  const env = {
    HOST_MONITOR_QUEUE: { async send(body) { sent.push(body); } },
  };
  await runBudgetedRuntimeScheduled(
    { cron: '* * * * *', scheduledTime: 1 * MINUTE_MS },
    env,
    {},
    {
      async dispatchPendingMinuteFacts() { calls.push('recovery'); return 'recovery'; },
    },
  );
  await runBudgetedRuntimeScheduled(
    { cron: '* * * * *', scheduledTime: 10 * MINUTE_MS },
    env,
    {},
    {
      async runStreamPrediction() { calls.push('prediction'); return 'prediction'; },
    },
  );
  await runBudgetedRuntimeScheduled(
    { cron: '* * * * *', scheduledTime: 30 * MINUTE_MS },
    env,
    {},
    {
      async runMonitorMaintenance() { calls.push('maintenance'); return 'maintenance'; },
    },
  );
  assert.deepEqual(calls, ['recovery', 'prediction', 'maintenance']);
  assert.deepEqual(sent, []);
});

test('recovery and sync maintenance bypass the rebuild Queue', async () => {
  const calls = [];
  const sent = [];
  const env = {
    HOST_MONITOR_QUEUE: { async send(body) { sent.push(body); } },
    MINUTE_REBUILD_QUEUE: { async send(body) { sent.push(body); } },
  };
  await runBudgetedRuntimeScheduled(
    { cron: '* * * * *', scheduledTime: 5 * MINUTE_MS },
    env,
    {},
    { async runMinuteRecovery() { calls.push('recovery'); return { inline: true }; } },
  );
  await runBudgetedRuntimeScheduled(
    { cron: '* * * * *', scheduledTime: 9 * MINUTE_MS },
    env,
    {},
    { async runMinuteSync() { calls.push('sync'); return { inline: true }; } },
  );
  assert.deepEqual(calls, ['recovery', 'sync']);
  assert.deepEqual(sent, []);
});

test('all downstream Queue sends carry producer and operation attribution', async () => {
  const sent = [];
  const env = attributedRuntimeEnv({
    MINUTE_DERIVE_QUEUE: {
      async send(body, options) { sent.push({ body, options }); },
    },
  });
  await env.MINUTE_DERIVE_QUEUE.send(
    { message_type: 'minute-fact-derive', message_version: 1 },
    { contentType: 'json' },
  );
  assert.deepEqual(sent[0].body, {
    message_type: 'minute-fact-derive',
    message_version: 1,
    producer_worker: 'sh-runtime-orchestrator',
    operation_name: 'minute-derive',
  });
});

test('runtime configuration applies safe batching, retry, sampling, and dashboard budgets', () => {
  const config = JSON.parse(readFileSync(new URL('../wrangler.runtime.jsonc', import.meta.url), 'utf8'));
  assert.equal(config.main, 'src/runtime-orchestrator-deployed-entry.js');
  assert.equal(config.observability.head_sampling_rate, 0.1);
  assert.equal(config.observability.logs.head_sampling_rate, 0.1);
  assert.equal(config.vars.PAGES_DASHBOARD_MATERIALIZATION_INTERVAL_MINUTES, 15);
  assert.equal(config.vars.DERIVE_MAX_ATTEMPTS, 4);
  const consumers = new Map(config.queues.consumers.map((consumer) => [consumer.queue, consumer]));
  assert.equal(consumers.get('stationhead-host-monitor').max_batch_size, 10);
  assert.equal(consumers.get('stationhead-host-monitor').max_batch_timeout, 5);
  for (const [queue, consumer] of consumers) {
    if (queue === 'stationhead-host-monitor') continue;
    assert.equal(consumer.max_batch_size, 1, queue);
  }
  assert.equal(config.queues.consumers.every(({ max_retries }) => max_retries <= 4), true);
});
