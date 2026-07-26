import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  MINUTE_FACT_REPAIR_BURST_MESSAGE,
  minuteFactRepairBurstComplete,
} from '../src/minute-fact-repair-burst.js';
import { processMinutePipelineBatch } from '../src/minute-pipeline-entry.js';
import {
  RuntimeCoordinator,
  minuteFactRepairBurstDue,
  runRuntimeOrchestratorQueue,
  runRuntimeOrchestratorScheduled,
} from '../src/runtime-orchestrator-deployed-entry.js';

const repairSource = readFileSync(
  new URL('../src/minute-facts-repair.js', import.meta.url),
  'utf8',
);
const burstSource = readFileSync(
  new URL('../src/minute-fact-repair-burst.js', import.meta.url),
  'utf8',
);
const retireRepairIndexMigration = readFileSync(
  new URL('../../database/facts-migrations/043_retire_repair_candidate_index.sql', import.meta.url),
  'utf8',
);
const retireRepairWorkMigration = readFileSync(
  new URL('../../database/facts-migrations/044_retire_minute_fact_repair_work.sql', import.meta.url),
  'utf8',
);
const runtimeConfig = JSON.parse(readFileSync(
  new URL('../wrangler.runtime.jsonc', import.meta.url),
  'utf8',
));

test('production retires the completed repair burst while preserving bounded settings', () => {
  assert.equal(runtimeConfig.vars.MINUTE_FACT_REPAIR_BURST_ENABLED, false);
  assert.equal(runtimeConfig.vars.MINUTE_FACT_REPAIR_BURST_INTERVAL_MINUTES, 60);
  assert.equal(runtimeConfig.vars.MINUTE_FACT_REPAIR_CANDIDATE_LIMIT, 20);
  assert.equal(runtimeConfig.vars.MINUTE_FACT_REPAIR_ENQUEUE_LIMIT, 2);
  assert.equal(runtimeConfig.vars.MINUTE_FACT_REPAIR_DISPATCH_LIMIT, 2);
  assert.equal(runtimeConfig.vars.DERIVE_REVISION_CHUNK_TRACKS, 20);
  const rebuild = runtimeConfig.queues.consumers.find(
    ({ queue }) => queue === 'stationhead-minute-derive',
  );
  assert.equal(rebuild.max_batch_size, 1);
  assert.equal(rebuild.max_concurrency, 250);
});

test('repair candidate scan advances through the existing time index with durable state', () => {
  assert.match(repairSource, /INDEXED BY idx_sh_minute_facts_time/);
  assert.match(repairSource, /FROM sh_migration_state WHERE migration_key=\?/);
  assert.match(repairSource, /f\.minute_at>\? OR \(f\.minute_at=\? AND f\.id>\?\)/);
  assert.match(repairSource, /ON CONFLICT\(migration_key\) DO UPDATE SET/);
  assert.match(repairSource, /NOT EXISTS \(/);
  assert.match(repairSource, /r\.repair_key=\? AND r\.fact_id=f\.id/);
  assert.doesNotMatch(repairSource, /INDEXED BY idx_sh_minute_facts_repair_candidates/);
  assert.match(retireRepairIndexMigration, /DROP INDEX IF EXISTS idx_sh_minute_facts_repair_candidates/);
  assert.doesNotMatch(retireRepairIndexMigration, /CREATE INDEX|FROM sh_minute_facts|INSERT|UPDATE|DELETE/);
  assert.match(retireRepairWorkMigration, /WHERE job_kind='repair'/);
  assert.match(retireRepairWorkMigration, /status='done'/);
  assert.match(retireRepairWorkMigration, /phase='complete'/);
  assert.match(repairSource, /MAX_REPAIR_CANDIDATES = 100/);
  assert.match(repairSource, /MAX_REPAIR_ENQUEUES = 100/);
  assert.match(burstSource, /job_kind='repair'/);
  assert.match(burstSource, /job_kind: 'repair'/);
  assert.match(burstSource, /MAX_BURST_CANDIDATES = 20/);
  assert.match(burstSource, /MAX_BURST_ENQUEUES = 2/);
  assert.match(burstSource, /MAX_BURST_DISPATCH = 2/);
});

test('coordinated runtime schedules one isolated attributed repair burst in the hourly slot', async () => {
  const sent = [];
  let kvReads = 0;
  const dueAt = Date.UTC(2026, 0, 1, 0, 12, 0);
  const env = {
    MINUTE_FACT_REPAIR_BURST_ENABLED: true,
    MINUTE_FACT_REPAIR_BURST_INTERVAL_MINUTES: 60,
    PAGES_RESPONSE_KV: { async get() { kvReads += 1; return null; } },
    HOST_MONITOR_QUEUE: {
      async send(body, options) { sent.push({ body, options }); },
    },
  };
  assert.equal(minuteFactRepairBurstDue({ scheduledTime: dueAt }, env), true);
  assert.equal(minuteFactRepairBurstDue({ scheduledTime: dueAt + 60_000 }, env), false);

  const result = await runRuntimeOrchestratorScheduled(
    { cron: '* * * * *', scheduledTime: dueAt },
    env,
    {},
    { runDirect: async () => ({ runtime: 'ok', pages: 'ok' }) },
  );
  const skipped = await runRuntimeOrchestratorScheduled(
    { cron: '* * * * *', scheduledTime: dueAt + 60_000 },
    env,
    {},
    { runDirect: async () => ({ runtime: 'ok', pages: 'ok' }) },
  );

  assert.equal(kvReads, 0);
  assert.equal(result.repairBurst.dispatched, true);
  assert.deepEqual(skipped.repairBurst, { skipped: true, reason: 'repair-burst-cadence' });
  assert.deepEqual(sent, [{
    body: {
      message_type: MINUTE_FACT_REPAIR_BURST_MESSAGE,
      message_version: 1,
      scheduled_at: dueAt,
      producer_worker: 'sh-runtime-orchestrator',
      operation_name: 'minute-fact-repair-burst',
    },
    options: { contentType: 'json' },
  }]);
});

test('coordinator completion state suppresses future repair burst messages', async () => {
  const actions = [];
  const sent = [];
  const stub = {
    async fetch(_url, init) {
      const body = JSON.parse(init.body);
      actions.push(body.action);
      if (body.action === 'claim') {
        return Response.json({
          claimed: true,
          holder_id: 'holder-1',
          repair_complete: true,
        });
      }
      return Response.json({ released: true });
    },
  };
  const result = await runRuntimeOrchestratorScheduled(
    { cron: '* * * * *', scheduledTime: 123_000 },
    {
      MINUTE_FACT_REPAIR_BURST_ENABLED: true,
      HOST_MONITOR_QUEUE: { async send(body) { sent.push(body); } },
    },
    {},
    {
      stub,
      runDirect: async () => ({ runtime: 'ok', pages: 'ok' }),
    },
  );

  assert.deepEqual(actions, ['claim', 'release']);
  assert.deepEqual(sent, []);
  assert.deepEqual(result.repairBurst, { skipped: true, reason: 'repair-burst-complete' });
});

test('repair burst queue invocation acknowledges and records completion in the coordinator', async () => {
  const events = [];
  const actions = [];
  const coordinator = {
    async fetch(_url, init) {
      const body = JSON.parse(init.body);
      actions.push(body.action);
      return Response.json({ complete: true });
    },
  };
  await runRuntimeOrchestratorQueue({
    queue: 'stationhead-host-monitor',
    messages: [{
      body: {
        message_type: MINUTE_FACT_REPAIR_BURST_MESSAGE,
        message_version: 1,
        scheduled_at: 123_000,
      },
      ack() { events.push('ack'); },
      retry() { events.push('retry'); },
    }],
  }, {
    RUNTIME_COORDINATOR: { getByName() { return coordinator; } },
  }, {}, {
    repair: {
      async runMinuteFactRepairBurst(_env, { now }) {
        assert.equal(now, 123_000);
        events.push('repair');
        return { repair: { complete: true } };
      },
    },
  });
  assert.deepEqual(actions, ['repair-complete']);
  assert.deepEqual(events, ['repair', 'ack']);
});

test('runtime coordinator persists completion and returns it with future claims', async () => {
  const rows = new Map();
  const coordinator = new RuntimeCoordinator({
    storage: {
      async get(key) { return rows.get(key); },
      async put(key, value) { rows.set(key, value); },
    },
  });
  const complete = await coordinator.fetch(new Request('https://internal/lease', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'repair-complete', completed_at: 1000 }),
  }));
  assert.equal(complete.status, 200);
  assert.equal((await complete.json()).complete, true);

  const claim = await coordinator.fetch(new Request('https://internal/lease', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      action: 'claim',
      cron: '* * * * *',
      scheduledTime: 123_000,
      now: 2_000,
      leaseMs: 70_000,
    }),
  }));
  const body = await claim.json();
  assert.equal(body.claimed, true);
  assert.equal(body.repair_complete, true);
});

test('repair triggers bypass the ordinary historical rebuild pause', async () => {
  const calls = [];
  const batch = {
    queue: 'stationhead-minute-derive',
    messages: [{
      body: {
        message_type: 'minute-fact-derive',
        message_version: 1,
        job_id: 'minute-fact:10:60000',
        channel_id: 10,
        minute_at: 60_000,
        job_kind: 'repair',
      },
      ack() { calls.push('unexpected-ack'); },
    }],
  };
  const result = await processMinutePipelineBatch(
    batch,
    { HISTORICAL_REBUILD_ENABLED: false },
    {},
    {
      async processMinuteDeriveBatch(receivedBatch) {
        calls.push(receivedBatch.queue);
        return 'processed-repair';
      },
    },
  );
  assert.equal(result, 'processed-repair');
  assert.deepEqual(calls, ['stationhead-minute-derive']);
});

test('completion marker remains readable for external diagnostics', async () => {
  assert.equal(await minuteFactRepairBurstComplete({
    PAGES_RESPONSE_KV: { async get() { return '1'; } },
  }), true);
});
