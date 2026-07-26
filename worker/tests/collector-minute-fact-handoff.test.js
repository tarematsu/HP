import assert from 'node:assert/strict';
import test from 'node:test';

import { handoffMinuteFactJob } from '../src/collector-minute-fact-handoff.js';

function fakeDb() {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      const call = { sql: String(sql), params: [] };
      calls.push(call);
      return {
        bind(...params) {
          call.params = params;
          return this;
        },
        async all() { return { results: [] }; },
        async first() { return null; },
        async run() { return { meta: { changes: 1 } }; },
      };
    },
  };
}

function input() {
  return {
    observedAt: 1_784_000_000_000,
    snapshot: { channel_id: 10, station_id: 20 },
    queue: { station_id: 20, queue_id: 30, start_time: 1_783_999_000_000, tracks: [] },
    comments: { commentsSaved: 0, degraded: false },
  };
}

test('normal minute fact handoff avoids D1 outbox writes', async () => {
  const db = fakeDb();
  const sent = [];
  const result = await handoffMinuteFactJob({
    DB: db,
    MINUTE_FACT_QUEUE: { async send(message) { sent.push(message); } },
  }, input());

  assert.equal(sent.length, 1);
  assert.equal(result.enqueued, true);
  assert.equal(result.direct_handoff, true);
  assert.equal(result.inline_handoff, false);
  assert.equal(result.outbox_rows_written, 0);
  assert.equal(result.outbox_pending, false);
  assert.equal(db.calls.some(({ sql }) => /INSERT OR IGNORE INTO sh_minute_fact_outbox/.test(sql)), false);
});

test('enabled collector processes the current minute inline without Queue operations', async () => {
  const db = fakeDb();
  let inlineCalls = 0;
  const result = await handoffMinuteFactJob({
    DB: db,
    MINUTE_DB: db,
    COLLECTOR_MINUTE_FACT_INLINE_ENABLED: true,
    MINUTE_FACT_QUEUE: { async send() { assert.fail('successful inline work must not send a Queue message'); } },
  }, input(), {}, {
    async processInlineMinuteFactJob(_env, value) {
      inlineCalls += 1;
      return {
        enqueued: true,
        channel_id: value.snapshot.channel_id,
        minute_at: 1_784_000_000_000,
      };
    },
  });

  assert.equal(inlineCalls, 1);
  assert.equal(result.enqueued, true);
  assert.equal(result.inline_handoff, true);
  assert.equal(result.direct_handoff, false);
  assert.equal(result.queue_send_attempts, 0);
  assert.equal(result.inline_fallback, false);
  assert.equal(result.outbox_rows_written, 0);
});

test('inline failure falls back to the existing durable Queue handoff', async () => {
  const db = fakeDb();
  const sent = [];
  const result = await handoffMinuteFactJob({
    DB: db,
    MINUTE_DB: db,
    COLLECTOR_MINUTE_FACT_INLINE_ENABLED: true,
    MINUTE_FACT_QUEUE: { async send(message) { sent.push(message); } },
  }, input(), {}, {
    async processInlineMinuteFactJob() {
      throw new Error('inline unavailable');
    },
  });

  assert.equal(sent.length, 1);
  assert.equal(result.enqueued, true);
  assert.equal(result.inline_handoff, false);
  assert.equal(result.inline_fallback, true);
  assert.equal(result.direct_handoff, true);
  assert.equal(result.queue_send_attempts, 1);
  assert.equal(result.outbox_pending, false);
});

test('failed direct handoff stages only the current job in D1', async () => {
  const db = fakeDb();
  const result = await handoffMinuteFactJob({
    DB: db,
    MINUTE_FACT_QUEUE: { async send() { throw new Error('queue unavailable'); } },
  }, input());

  assert.equal(result.enqueued, false);
  assert.equal(result.direct_handoff, false);
  assert.equal(result.outbox_pending, true);
  assert.equal(result.outbox_rows_written, 1);
  assert.equal(db.calls.filter(({ sql }) => /INSERT OR IGNORE INTO sh_minute_fact_outbox/.test(sql)).length, 1);
});

test('current minute waits behind an older pending outbox backlog', async () => {
  const events = [];
  const result = await handoffMinuteFactJob({
    MINUTE_DB: fakeDb(),
    COLLECTOR_MINUTE_FACT_INLINE_ENABLED: true,
  }, input(), {}, {
    async flushPending() {
      events.push('flush');
      return { sent: 3, failed: 0, pending: true, current_sent: false };
    },
    async cleanupSentOutbox() {
      events.push('cleanup');
      return 2;
    },
    async processInlineMinuteFactJob() {
      assert.fail('current minute must not overtake pending jobs inline');
    },
    async sendMinuteFactJob() {
      assert.fail('current minute must not overtake pending jobs');
    },
    async stageMinuteFactOutboxJob() {
      events.push('stage');
      return {
        message: { job_id: 'minute-fact:10:1784000000000' },
        enqueued: false,
        outbox_pending: true,
        minute_at: 1_784_000_000_000,
      };
    },
  });

  assert.deepEqual(events, ['flush', 'cleanup', 'stage']);
  assert.equal(result.direct_handoff, false);
  assert.equal(result.inline_handoff, false);
  assert.equal(result.deferred_behind_pending, true);
  assert.equal(result.pending_flushed, 3);
  assert.equal(result.outbox_rows_written, 4);
  assert.equal(result.outbox_rows_deleted, 2);
});

test('cleanup keeps unconsumed pointer ledgers', async () => {
  const db = fakeDb();
  await handoffMinuteFactJob({
    DB: db,
    MINUTE_FACT_QUEUE: { async send() {} },
  }, input(), {}, {
    async flushPending() {
      return { sent: 1, failed: 0, pending: false, current_sent: false };
    },
    async sendMinuteFactJob() {
      return { enqueued: true, minute_at: 1_784_000_000_000 };
    },
  });
  const cleanup = db.calls.find(({ sql }) => /DELETE FROM sh_minute_fact_outbox/.test(sql));
  assert.match(cleanup.sql, /payload_json='\{\}'/);
  assert.match(cleanup.sql, /consumed/);
});
