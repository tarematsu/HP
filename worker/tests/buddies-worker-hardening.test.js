import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BUDDIES_COLLECTOR_COORDINATOR_STATE,
  BuddiesCollectorCoordinator,
} from '../src/buddies-collector-do-entry.js';
import { runBuddiesRecoveryQueue } from '../src/buddies-recovery-core.js';
import {
  flushResilientMinuteFactOutbox,
  minuteFactOutboxRetryDelayMs,
} from '../src/collector-minute-fact-outbox.js';
import {
  COLLECTOR_OPERATIONAL_TELEMETRY,
  recordCollectorOperationalTelemetry,
} from '../src/collector-operational-telemetry.js';
import { collectRawChannel } from '../src/raw-collector-entry.js';
import {
  consumerScriptsFromValue,
  parseConsumerListOutput,
} from '../scripts/cloudflare-queues.mjs';

function outboxDb(rows) {
  return {
    rows,
    prepare(sql) {
      const source = String(sql);
      let params = [];
      return {
        bind(...values) {
          params = values;
          return this;
        },
        async first() {
          if (/COUNT\(\*\)/.test(source)) {
            return { count: rows.filter((row) => row.status === 'pending').length };
          }
          if (/SELECT status,payload_json/.test(source)) {
            const row = rows.find((entry) => entry.job_id === params[0]);
            return row ? { status: row.status, payload_json: row.payload_json } : null;
          }
          if (/FROM sh_minute_fact_outbox/.test(source)) {
            return rows
              .filter((row) => row.status === 'pending')
              .sort((left, right) => left.created_at - right.created_at)[0] || null;
          }
          return null;
        },
        async run() {
          if (/status='sent',payload_json=\?/.test(source)) {
            const [payload, sentAt, lastAttemptAt, lastError, jobId] = params;
            const row = rows.find((entry) => entry.job_id === jobId && entry.status === 'pending');
            if (!row) return { success: true, meta: { changes: 0 } };
            Object.assign(row, {
              status: 'sent',
              payload_json: payload,
              sent_at: sentAt,
              last_attempt_at: lastAttemptAt,
              last_error: lastError,
            });
            return { success: true, meta: { changes: 1 } };
          }
          return { success: true, meta: { changes: 0 } };
        },
      };
    },
  };
}

test('poison outbox rows are quarantined before later rows are delivered', async () => {
  const rows = [
    {
      job_id: 'minute-fact:1:1',
      status: 'pending',
      payload_json: '{broken',
      attempts: 5,
      created_at: 1,
      last_attempt_at: 1,
      last_error: 'invalid json',
    },
    {
      job_id: 'minute-fact:1:2',
      status: 'pending',
      payload_json: '{}',
      attempts: 0,
      created_at: 2,
      last_attempt_at: null,
      last_error: null,
    },
  ];
  const db = outboxDb(rows);
  const delivered = [];
  const result = await flushResilientMinuteFactOutbox({
    DB: db,
    MINUTE_FACT_QUEUE: { async send() {} },
  }, { limit: 3 }, {
    now: () => 100_000,
    async flushMinuteFactOutbox() {
      const row = rows.find((entry) => entry.status === 'pending');
      delivered.push(row.job_id);
      row.status = 'sent';
      row.payload_json = '{}';
      return { sent: 1, failed: 0, pending: false, current_sent: false };
    },
  });

  assert.equal(result.quarantined, 1);
  assert.deepEqual(result.quarantined_job_ids, ['minute-fact:1:1']);
  assert.deepEqual(delivered, ['minute-fact:1:2']);
  assert.equal(result.pending, false);
  assert.match(rows[0].payload_json, /"quarantined":true/);
});

test('outbox retries use exponential backoff before another Queue attempt', async () => {
  const now = 500_000;
  const rows = [{
    job_id: 'minute-fact:1:1',
    status: 'pending',
    payload_json: '{}',
    attempts: 3,
    created_at: 1,
    last_attempt_at: now - 1_000,
    last_error: 'temporary',
  }];
  let flushes = 0;
  const result = await flushResilientMinuteFactOutbox({
    DB: outboxDb(rows),
    MINUTE_FACT_QUEUE: { async send() {} },
  }, {}, {
    now: () => now,
    async flushMinuteFactOutbox() { flushes += 1; },
  });

  assert.equal(flushes, 0);
  assert.equal(result.pending, true);
  assert.equal(result.backoff_ms, minuteFactOutboxRetryDelayMs(3) - 1_000);
});

function durableStorage({ failCompletion = false } = {}) {
  const values = new Map();
  let alarm = null;
  return {
    values,
    async get(key) { return values.get(key); },
    async put(key, value) {
      if (failCompletion
          && key === BUDDIES_COLLECTOR_COORDINATOR_STATE.minute_state_key
          && value?.status === 'completed') {
        throw new Error('checkpoint unavailable');
      }
      values.set(key, value);
    },
    async delete(key) { values.delete(key); },
    async getAlarm() { return alarm; },
    async setAlarm(value) { alarm = value; },
  };
}

test('collector alarm uses the persisted scheduled minute after delayed execution', async () => {
  const storage = durableStorage();
  let receivedScheduledAt = null;
  const times = [180_000, 180_100, 180_200, 180_300];
  const coordinator = new BuddiesCollectorCoordinator({ storage }, {}, {
    now: () => times.shift() ?? 180_300,
    direct: {
      async collectRawChannel() {
        receivedScheduledAt = storage.values.get(
          BUDDIES_COLLECTOR_COORDINATOR_STATE.minute_state_key,
        ).scheduled_at;
        return {};
      },
    },
  });
  await coordinator.schedule({ scheduledTime: 60_123 });
  await coordinator.alarm();
  assert.equal(receivedScheduledAt, 60_123);
  assert.equal(
    storage.values.get(BUDDIES_COLLECTOR_COORDINATOR_STATE.minute_state_key).minute_at,
    60_000,
  );
});

test('completion checkpoint failure remains fail-closed on alarm retry', async () => {
  const storage = durableStorage({ failCompletion: true });
  await storage.put(BUDDIES_COLLECTOR_COORDINATOR_STATE.pending_schedule_key, {
    scheduled_at: 120_000,
    minute_at: 120_000,
  });
  let collections = 0;
  const coordinator = new BuddiesCollectorCoordinator({ storage }, {}, {
    now: () => 120_500,
    direct: {
      async collectRawChannel() {
        collections += 1;
        return {};
      },
    },
  });

  await assert.rejects(coordinator.alarm(), /checkpoint unavailable/);
  const retry = await coordinator.alarm();
  assert.equal(collections, 1);
  assert.equal(retry.reason, 'collector-minute-in-flight-or-uncertain');
});

test('recovery processes every message and persists unsampled queue telemetry', async () => {
  const calls = [];
  const objects = [];
  function message(id) {
    return {
      body: { message_type: `task-${id}`, id },
      timestamp: new Date(1_000),
      ack() { calls.push(`ack:${id}`); },
      retry() { calls.push(`retry:${id}`); },
    };
  }
  const summary = await runBuddiesRecoveryQueue({
    queue: 'stationhead-raw-collection',
    messages: [message(1), message(2)],
  }, {
    PAGES_RESPONSE_R2: {
      async get() { return null; },
      async put(key, value) { objects.push({ key, value }); },
    },
  }, {}, {
    now: (() => {
      const values = [10_000, 10_025];
      return () => values.shift() ?? 10_025;
    })(),
    async runIngestQueue(batch) {
      const [entry] = batch.messages;
      if (entry.body.id === 1) entry.ack();
      else entry.retry();
    },
  });

  assert.deepEqual(calls, ['ack:1', 'retry:2']);
  assert.equal(summary.processed, 2);
  assert.equal(summary.acknowledged, 1);
  assert.equal(summary.retried, 1);
  assert.equal(summary.failed, 1);
  assert.equal(objects.length, 1);
  assert.match(objects[0].key, /operational\/recovery/);
  assert.equal(JSON.parse(objects[0].value).processed, 2);
});

test('collector telemetry reports dropped windows and drains multiple windows', async () => {
  const duration = COLLECTOR_OPERATIONAL_TELEMETRY.default_interval_ms;
  const pending = Array.from({ length: 14 }, (_, index) => ({
    bucket_start: index * duration,
    bucket_end: (index + 1) * duration,
    source: 'sh-buddies-collector',
  }));
  const values = new Map([[
    COLLECTOR_OPERATIONAL_TELEMETRY.state_key,
    { active: null, pending, dropped_windows: 0, delivery_failures: 0 },
  ]]);
  const delivered = [];
  await recordCollectorOperationalTelemetry({
    storage: {
      async get(key) { return values.get(key); },
      async put(key, value) { values.set(key, value); },
    },
  }, {
    PAGES_RESPONSE_R2: {
      async put(key) { delivered.push(key); },
    },
  }, {
    ok: true,
    timestamp: 20 * duration,
    duration_ms: 1,
  });

  const stored = values.get(COLLECTOR_OPERATIONAL_TELEMETRY.state_key);
  assert.equal(stored.dropped_windows, 2);
  assert.equal(delivered.length, 3);
  assert.equal(stored.pending.length, 9);
  assert.equal(stored.active.dropped_windows_total, 2);
});

test('prepared-message fallback exposes reason and stage without changing Queue payload shape', async () => {
  let received;
  const result = await collectRawChannel({
    CHANNEL_ALIAS: 'buddies',
    COLLECTOR_INLINE_PIPELINE_ENABLED: true,
  }, {
    ensureSession: async () => ({
      authToken: 'token',
      deviceUid: 'device',
      tokenExpiresAt: 9_999_999_999_999,
    }),
    fetch: async () => new Response(JSON.stringify({
      id: 1,
      alias: 'unexpected',
      current_station_id: 2,
    }), { status: 200 }),
    async ingestRawCollection(_env, message) {
      received = message;
      return {};
    },
  });

  assert.equal(result.message_version, 2);
  assert.equal(result.prepared_fallback, 1);
  assert.equal(result.prepared_fallback_stage, 'validate-channel');
  assert.equal(Object.hasOwn(received, 'preparation_fallback'), true);
  assert.equal(JSON.stringify(received).includes('preparation_fallback'), false);
});

test('consumer ownership parsing requires exact script names', () => {
  const parsed = parseConsumerListOutput(`warning\n[{"script_name":"sh-buddies-recovery-shadow"},{"service":"sh-buddies-recovery"}]\n`);
  const scripts = consumerScriptsFromValue(parsed);
  assert.equal(scripts.has('sh-buddies-recovery'), true);
  assert.equal(scripts.has('sh-buddies'), false);
  assert.equal(scripts.has('sh-buddies-recovery-shadow'), true);
});
