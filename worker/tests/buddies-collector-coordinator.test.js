import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  BuddiesCollectorCoordinator,
  runAlarmCoordinatedBuddiesCollectorScheduled,
} from '../src/buddies-collector-entry.js';
import { recordCollectorOperationalTelemetry } from '../src/collector-operational-telemetry.js';

function storage() {
  const values = new Map();
  let alarm = null;
  return {
    values,
    async get(key) { return values.get(key); },
    async put(key, value) { values.set(key, value); },
    async getAlarm() { return alarm; },
    async setAlarm(value) { alarm = value; },
    alarm() { return alarm; },
  };
}

test('scheduled collector only arms the Durable Object alarm', async () => {
  const calls = [];
  const result = await runAlarmCoordinatedBuddiesCollectorScheduled({
    cron: '* * * * *',
    scheduledTime: 123,
  }, {}, {}, {
    stub: {
      async fetch(_url, init) {
        calls.push(JSON.parse(init.body));
        return Response.json({ scheduled: true, alarm_at: 123 });
      },
    },
    direct: {
      async collectRawChannel() {
        throw new Error('direct collection must not run from Cron');
      },
    },
  });

  assert.deepEqual(calls, [{ action: 'schedule', scheduledTime: 123 }]);
  assert.deepEqual(result, { scheduled: true, alarm_at: 123 });
});

test('coordinator failures fail closed instead of double collecting', async () => {
  let directCalls = 0;
  await assert.rejects(runAlarmCoordinatedBuddiesCollectorScheduled({
    cron: '* * * * *',
    scheduledTime: 123,
  }, { BUDDIES_COLLECTOR_COORDINATOR: {} }, {}, {
    stub: {
      async fetch() { throw new Error('response lost after alarm scheduling'); },
    },
    direct: {
      async collectRawChannel() { directCalls += 1; },
    },
  }), /response lost/);
  assert.equal(directCalls, 0);
});

test('collector coordinator deduplicates pending alarms', async () => {
  const durableStorage = storage();
  const coordinator = new BuddiesCollectorCoordinator(
    { storage: durableStorage },
    {},
    { now: () => 100 },
  );

  const first = await coordinator.fetch(new Request('https://internal/schedule', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'schedule', scheduledTime: 123 }),
  }));
  assert.equal(first.status, 200);
  assert.equal((await first.json()).scheduled, true);
  assert.equal(durableStorage.alarm(), 123);

  const duplicate = await coordinator.schedule({ scheduledTime: 124 });
  assert.equal(duplicate.scheduled, false);
  assert.equal(duplicate.reason, 'collector-alarm-pending');
  assert.equal(durableStorage.alarm(), 123);
});

test('collector alarm runs at most once per successful minute', async () => {
  const durableStorage = storage();
  let collections = 0;
  const coordinator = new BuddiesCollectorCoordinator(
    { storage: durableStorage },
    {},
    {
      now: () => 120_001,
      direct: {
        async collectRawChannel() {
          collections += 1;
          return { payload_bytes: 123, queue_send_attempts: 1 };
        },
      },
    },
  );

  assert.equal((await coordinator.alarm()).collected, true);
  const duplicate = await coordinator.alarm();
  assert.equal(collections, 1);
  assert.equal(duplicate.skipped, true);
  assert.equal(duplicate.reason, 'collector-minute-already-completed');
  const telemetry = durableStorage.values.get('collector:operational-telemetry');
  assert.equal(telemetry.active.payload_bytes_sum, 123);
  assert.equal(telemetry.active.queue_send_attempts_sum, 1);
});

test('collector telemetry persists completed windows to R2', async () => {
  const durableStorage = storage();
  const objects = [];
  const env = {
    COLLECTOR_TELEMETRY_INTERVAL_MS: 300_000,
    PAGES_RESPONSE_R2: {
      async put(key, value, options) { objects.push({ key, value, options }); },
    },
  };
  await recordCollectorOperationalTelemetry({ storage: durableStorage }, env, {
    ok: false,
    timestamp: 1,
    duration_ms: 20,
  });
  await recordCollectorOperationalTelemetry({ storage: durableStorage }, env, {
    ok: true,
    timestamp: 300_001,
    duration_ms: 9,
  });
  assert.equal(objects.length, 1);
  assert.equal(objects[0].key, 'operational/collector/1970/01/01/00-00.json');
  assert.equal(JSON.parse(objects[0].value).failures, 1);
  assert.equal(objects[0].options.httpMetadata.contentType, 'application/json');
});

test('collector telemetry retains a completed window when R2 is unavailable', async () => {
  const durableStorage = storage();
  const env = { COLLECTOR_TELEMETRY_INTERVAL_MS: 300_000 };
  await recordCollectorOperationalTelemetry({ storage: durableStorage }, env, {
    ok: true,
    timestamp: 1,
    duration_ms: 12,
  });
  await recordCollectorOperationalTelemetry({ storage: durableStorage }, env, {
    ok: true,
    timestamp: 300_001,
    duration_ms: 8,
  });
  const telemetry = durableStorage.values.get('collector:operational-telemetry');
  assert.equal(telemetry.pending.length, 1);
  assert.equal(telemetry.pending[0].collections, 1);
  assert.equal(telemetry.pending[0].duration_ms_max, 12);
});

test('production collector declares the coordinator migration and sampled logs', () => {
  const config = JSON.parse(readFileSync(
    new URL('../wrangler.buddies-collector.jsonc', import.meta.url),
    'utf8',
  ));
  assert.equal(
    config.durable_objects.bindings.find(({ name }) => name === 'BUDDIES_COLLECTOR_COORDINATOR').class_name,
    'BuddiesCollectorCoordinator',
  );
  assert.deepEqual(
    config.migrations.find(({ tag }) => tag === 'buddies-collector-coordinator-v1').new_sqlite_classes,
    ['BuddiesCollectorCoordinator'],
  );
  assert.equal(config.vars.COLLECTOR_TELEMETRY_INTERVAL_MS, 300_000);
  assert.equal(config.observability.head_sampling_rate, 0.1);
  assert.equal(config.observability.logs.head_sampling_rate, 0.1);
  assert.equal(config.observability.logs.invocation_logs, true);
  assert.deepEqual(config.queues.consumers, []);
});
