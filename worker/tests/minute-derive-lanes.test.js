import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  enqueueMinuteDeriveTrigger,
  pendingMinuteDeriveTriggers,
} from '../src/minute-derive-trigger.js';

function config(name) {
  return JSON.parse(readFileSync(new URL(`../${name}`, import.meta.url), 'utf8'));
}

test('runtime Worker keeps a drain-only ordered derive Queue and an active live lane', () => {
  const runtime = config('wrangler.runtime.jsonc');
  const queues = runtime.queues.consumers.filter(({ queue }) => [
    'stationhead-minute-derive',
    'stationhead-minute-live-derive',
    'stationhead-buddies-facts',
  ].includes(queue));
  assert.deepEqual(queues.map(({ queue }) => queue), [
    'stationhead-minute-derive',
    'stationhead-minute-live-derive',
    'stationhead-buddies-facts',
  ]);
  assert.deepEqual(queues.map(({ max_concurrency }) => max_concurrency), [1, 2, 1]);
  assert.equal(
    runtime.queues.producers.find(({ binding }) => binding === 'MINUTE_LIVE_DERIVE_QUEUE').queue,
    'stationhead-minute-live-derive',
  );
  assert.equal(runtime.queues.producers.some(({ binding }) => binding === 'MINUTE_DERIVE_QUEUE'), false);
  assert.equal(runtime.queues.consumers.some(({ queue }) => queue === 'stationhead-minute-rebuild'), false);

  const pipeline = readFileSync(new URL('../src/minute-pipeline-entry.js', import.meta.url), 'utf8');
  assert.match(pipeline, /repair-actions-owned/);
  assert.match(pipeline, /rebuild-actions-owned/);
});

test('new live facts use only the live derive lane', async () => {
  const sent = [];
  const liveQueue = {
    async send(body, options) { sent.push({ lane: 'live', body, options }); },
  };
  const orderedQueue = {
    async send(body, options) { sent.push({ lane: 'ordered', body, options }); },
  };

  const trigger = await enqueueMinuteDeriveTrigger({
    MINUTE_LIVE_DERIVE_QUEUE: liveQueue,
    MINUTE_DERIVE_QUEUE: orderedQueue,
  }, { channel_id: 10, minute_at: 120_000 });

  assert.equal(trigger.job_kind, 'live');
  assert.deepEqual(sent, [{
    lane: 'live',
    body: trigger,
    options: { contentType: 'json' },
  }]);
});

test('repair and rebuild enqueue requests are rejected after Actions migration', async () => {
  const sent = [];
  const env = {
    MINUTE_LIVE_DERIVE_QUEUE: { async send(body) { sent.push(body); } },
    MINUTE_DERIVE_QUEUE: { async send(body) { sent.push(body); } },
  };

  for (const jobKind of ['repair', 'rebuild']) {
    await assert.rejects(
      enqueueMinuteDeriveTrigger(env, {
        channel_id: 10,
        minute_at: 120_000,
        job_kind: jobKind,
      }),
      (error) => error?.code === 'MINUTE_DERIVE_OFFLINE_WORK_RETIRED',
    );
  }
  assert.deepEqual(sent, []);
});

test('live recovery seeks only live pending jobs and expired leases', async () => {
  const calls = [];
  const responses = [
    [
      { id: 4, channel_id: 10, minute_at: 120_000, job_kind: 'live', job_priority: 100 },
      { id: 5, channel_id: 10, minute_at: 180_000, job_kind: 'live', job_priority: 100 },
    ],
    [],
  ];
  const MINUTE_DB = {
    prepare(sql) {
      const call = { sql, bindings: [] };
      calls.push(call);
      return {
        bind(...values) { call.bindings = values; return this; },
        async all() { return { results: responses[calls.indexOf(call)] }; },
      };
    },
  };

  const triggers = await pendingMinuteDeriveTriggers({
    MINUTE_DB,
    HISTORICAL_REBUILD_ENABLED: true,
    MINUTE_FACT_REPAIR_BURST_ENABLED: true,
  }, { now: 200_000, limit: 2 });
  assert.equal(calls.length, 2);
  assert.match(calls[0].sql, /INDEXED BY idx_sh_minute_fact_jobs_pending_ready/);
  assert.match(calls[0].sql, /status='pending' AND next_attempt_at<=\? AND job_kind='live'/);
  assert.match(calls[1].sql, /INDEXED BY idx_sh_minute_fact_jobs_processing_lease/);
  assert.match(calls[1].sql, /status='processing' AND lease_until<\? AND job_kind='live'/);
  assert.doesNotMatch(calls.map(({ sql }) => sql).join('\n'), /job_kind!='repair'|job_kind!='rebuild'|\sOR\s/);
  assert.deepEqual(calls.map(({ bindings }) => bindings), [[200_000, 2], [200_000, 2]]);
  assert.deepEqual(triggers.map(({ job_kind }) => job_kind), ['live', 'live']);
});

test('the active production deploy provisions the live derive queue and DLQ', () => {
  const workflow = readFileSync(
    new URL('../../.github/workflows/deploy-split-pipeline.yml', import.meta.url),
    'utf8',
  );
  assert.match(workflow, /stationhead-minute-live-derive stationhead-minute-live-derive-dlq/);
});
