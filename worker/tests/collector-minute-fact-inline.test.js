import assert from 'node:assert/strict';
import test from 'node:test';

import { processInlineMinuteFactJob } from '../src/collector-minute-fact-inline.js';

function input() {
  return {
    observedAt: 1_784_000_000_000,
    snapshot: { channel_id: 10, station_id: 20 },
    queue: { station_id: 20, queue_id: 30, start_time: 1_783_999_000_000, tracks: [] },
    comments: { commentsSaved: 0, degraded: false },
  };
}

test('inline processor reuses the production consumer with runtime-safe flags', async () => {
  const minuteDb = { prepare() {} };
  const result = await processInlineMinuteFactJob({ MINUTE_DB: minuteDb }, input(), {}, {
    async consumeMinuteQueue(batch, env) {
      assert.equal(batch.queue, 'stationhead-buddies-facts');
      assert.equal(batch.messages.length, 1);
      assert.equal(env.MINUTE_DB, minuteDb);
      assert.equal(env.LIVE_DERIVE_INLINE_ENABLED, true);
      assert.equal(env.LIVE_REVISION_MATERIALIZATION_ENABLED, false);
      assert.equal(env.MINUTE_ENRICHMENT_INLINE_PIPELINE_ENABLED, true);
      batch.messages[0].ack();
      return { received: 1, enqueued: 1, duplicates: 0, retried: 0, invalid: 0 };
    },
  });

  assert.equal(result.enqueued, true);
  assert.equal(result.duplicate, false);
  assert.equal(result.channel_id, 10);
});

test('inline processor converts consumer retry into a Queue fallback signal', async () => {
  await assert.rejects(processInlineMinuteFactJob({ MINUTE_DB: { prepare() {} } }, input(), {}, {
    async consumeMinuteQueue(batch) {
      batch.messages[0].retry({ delaySeconds: 5 });
      return { received: 1, enqueued: 0, duplicates: 0, retried: 1, invalid: 0 };
    },
  }), (error) => {
    assert.equal(error.code, 'COLLECTOR_INLINE_MINUTE_FACT_RETRY');
    assert.match(error.message, /after 5s/);
    return true;
  });
});

test('inline processor requires the collector MINUTE_DB binding', async () => {
  await assert.rejects(
    processInlineMinuteFactJob({}, input()),
    /collector inline MINUTE_DB binding is missing/,
  );
});
