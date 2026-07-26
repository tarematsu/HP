import assert from 'node:assert/strict';
import test from 'node:test';

import {
  processMinutePipelineBatch,
  REBUILD_DERIVE_QUEUE_NAME,
} from '../src/minute-pipeline-entry.js';

function recordingDb() {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      const call = { sql, bindings: [] };
      calls.push(call);
      return {
        bind(...bindings) {
          call.bindings = bindings;
          return this;
        },
        async run() {
          return { meta: { changes: 1 } };
        },
      };
    },
  };
}

test('repair write stages are retired by default without D1 derive work', async () => {
  const db = recordingDb();
  const events = [];
  const result = await processMinutePipelineBatch({
    queue: REBUILD_DERIVE_QUEUE_NAME,
    messages: [{
      body: {
        message_type: 'minute-fact-derive-stage',
        message_version: 1,
        stage: 'write',
        job: {
          id: 77,
          channel_id: 10,
          minute_at: 120_000,
          job_kind: 'repair',
        },
        payload: {
          payload_version: 1,
          rebuild: {
            repair: true,
            repair_key: 'total-listener-20260710-13-v1',
          },
        },
      },
      ack() { events.push('ack'); },
      retry() { events.push('retry'); },
    }],
  }, {
    MINUTE_DB: db,
  }, {}, {
    async processMinuteDeriveBatch() {
      events.push('unexpected-derive');
    },
  });

  assert.deepEqual(events, ['ack']);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'repair-burst-disabled');
  assert.equal(result.retired, 1);
  assert.equal(db.calls.length, 2);
  assert.match(db.calls[0].sql, /UPDATE sh_minute_fact_jobs/);
  assert.match(db.calls[0].sql, /job_kind='repair'/);
  assert.equal(db.calls[0].bindings.at(-1), 77);
  assert.match(db.calls[1].sql, /UPDATE sh_minute_fact_repairs/);
  assert.equal(db.calls[1].bindings.at(-1), 'total-listener-20260710-13-v1');
});

test('repair triggers retire their durable job by default', async () => {
  const db = recordingDb();
  const events = [];
  const result = await processMinutePipelineBatch({
    queue: REBUILD_DERIVE_QUEUE_NAME,
    messages: [{
      body: {
        message_type: 'minute-fact-derive',
        message_version: 1,
        job_id: 'minute-fact:10:120000',
        channel_id: 10,
        minute_at: 120_000,
        job_kind: 'repair',
      },
      ack() { events.push('ack'); },
    }],
  }, {
    MINUTE_DB: db,
  });

  assert.deepEqual(events, ['ack']);
  assert.equal(result.retired, 1);
  assert.equal(db.calls.length, 1);
  assert.match(db.calls[0].sql, /channel_id=\? AND minute_at=\?/);
  assert.deepEqual(db.calls[0].bindings.slice(-2), [10, 120_000]);
});

test('repair processing requires an explicit rollback opt-in', async () => {
  const events = [];
  const result = await processMinutePipelineBatch({
    queue: REBUILD_DERIVE_QUEUE_NAME,
    messages: [{
      body: {
        message_type: 'minute-fact-derive',
        message_version: 1,
        channel_id: 10,
        minute_at: 120_000,
        job_kind: 'repair',
      },
      ack() { events.push('ack'); },
    }],
  }, {
    MINUTE_FACT_REPAIR_BURST_ENABLED: true,
  }, {}, {
    async processMinuteDeriveBatch(batch) {
      events.push(`derive:${batch.queue}`);
      return { processed: 1 };
    },
  });

  assert.deepEqual(result, { processed: 1 });
  assert.deepEqual(events, [`derive:${REBUILD_DERIVE_QUEUE_NAME}`]);
});
