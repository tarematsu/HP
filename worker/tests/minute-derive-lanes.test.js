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

test('runtime Worker consumes isolated live and ordered derive queues', () => {
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
  assert.deepEqual(queues.map(({ max_concurrency }) => max_concurrency), [250, 2, 1]);
  assert.equal(
    runtime.queues.producers.find(({ binding }) => binding === 'MINUTE_LIVE_DERIVE_QUEUE').queue,
    'stationhead-minute-live-derive',
  );
  assert.equal(runtime.queues.consumers.some(({ queue }) => queue === 'stationhead-minute-rebuild'), false);
  assert.equal(runtime.queues.producers.some(({ binding }) => binding === 'MINUTE_REBUILD_QUEUE'), false);

  const entry = readFileSync(new URL('../src/minute-derive-entry.js', import.meta.url), 'utf8');
  assert.match(entry, /batch\?\.queue/);
  assert.match(entry, /MINUTE_LIVE_DERIVE_QUEUE/);
  assert.match(entry, /stationhead-minute-live-derive/);
});

test('new live facts prefer the empty live derive lane', async () => {
  const sent = [];
  const liveQueue = {
    async send(body, options) { sent.push({ lane: 'live', body, options }); },
  };
  const rebuildQueue = {
    async send(body, options) { sent.push({ lane: 'rebuild', body, options }); },
  };

  const trigger = await enqueueMinuteDeriveTrigger({
    MINUTE_LIVE_DERIVE_QUEUE: liveQueue,
    MINUTE_DERIVE_QUEUE: rebuildQueue,
  }, { channel_id: 10, minute_at: 120_000 });

  assert.equal(trigger.job_kind, 'live');
  assert.deepEqual(sent, [{
    lane: 'live',
    body: trigger,
    options: { contentType: 'json' },
  }]);
});

test('repair facts preserve their kind and use the ordered rebuild lane', async () => {
  const sent = [];
  const liveQueue = {
    async send(body) { sent.push({ lane: 'live', body }); },
  };
  const rebuildQueue = {
    async send(body, options) { sent.push({ lane: 'rebuild', body, options }); },
  };

  const trigger = await enqueueMinuteDeriveTrigger({
    MINUTE_LIVE_DERIVE_QUEUE: liveQueue,
    MINUTE_DERIVE_QUEUE: rebuildQueue,
  }, {
    channel_id: 10,
    minute_at: 120_000,
    job_kind: 'repair',
  });

  assert.equal(trigger.job_kind, 'repair');
  assert.deepEqual(sent, [{
    lane: 'rebuild',
    body: trigger,
    options: { contentType: 'json' },
  }]);
});

test('maintenance recovery seeks ready pending jobs and expired leases through separate indexes', async () => {
  const calls = [];
  const responses = [
    [
      { id: 4, channel_id: 10, minute_at: 120_000, job_kind: 'live', job_priority: 100 },
      { id: 5, channel_id: 10, minute_at: 180_000, job_kind: 'live', job_priority: 100 },
    ],
    [
      { id: 2, channel_id: 10, minute_at: 60_000, job_kind: 'rebuild', job_priority: 20 },
    ],
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

  const triggers = await pendingMinuteDeriveTriggers({ MINUTE_DB }, { now: 200_000, limit: 2 });
  assert.equal(calls.length, 2);
  assert.match(calls[0].sql, /INDEXED BY idx_sh_minute_fact_jobs_pending_ready/);
  assert.match(calls[0].sql, /status='pending' AND next_attempt_at<=\?/);
  assert.match(calls[0].sql, /ORDER BY next_attempt_at ASC,job_priority DESC,minute_at ASC,id ASC/);
  assert.match(calls[1].sql, /INDEXED BY idx_sh_minute_fact_jobs_processing_lease/);
  assert.match(calls[1].sql, /status='processing' AND lease_until<\?/);
  assert.doesNotMatch(calls.map(({ sql }) => sql).join('\n'), /\sOR\s/);
  assert.deepEqual(calls.map(({ bindings }) => bindings), [[200_000, 2], [200_000, 2]]);
  assert.deepEqual(triggers.map(({ job_kind }) => job_kind), ['live', 'live']);
});

test('enabled repair recovery preserves repair trigger identity', async () => {
  const calls = [];
  const MINUTE_DB = {
    prepare(sql) {
      calls.push(sql);
      return {
        bind() { return this; },
        async all() {
          return calls.length === 1
            ? { results: [{ id: 7, channel_id: 10, minute_at: 120_000, job_kind: 'repair', job_priority: 200 }] }
            : { results: [] };
        },
      };
    },
  };

  const triggers = await pendingMinuteDeriveTriggers({
    MINUTE_DB,
    MINUTE_FACT_REPAIR_BURST_ENABLED: true,
  }, { now: 200_000, limit: 2 });

  assert.deepEqual(triggers.map(({ job_kind }) => job_kind), ['repair']);
  assert.doesNotMatch(calls.join('\n'), /job_kind!='repair'/);
});

test('the active production deploy provisions the live derive queue and DLQ', () => {
  const workflow = readFileSync(
    new URL('../../.github/workflows/deploy-split-pipeline.yml', import.meta.url),
    'utf8',
  );
  assert.match(workflow, /stationhead-minute-live-derive stationhead-minute-live-derive-dlq/);
});
