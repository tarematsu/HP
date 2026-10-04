import assert from 'node:assert/strict';
import test from 'node:test';

import {
  KUGOU_ACG_BACKFILL_MESSAGE_TYPE,
  runRegionalMusicServiceQueue,
} from '../src/regional-music-service-entry.js';
import { runKugouAcgBackfillBatch } from '../src/kugou-acg-backfill.js';
import {
  KUGOU_ACG_HISTORY_INDEX_KEY,
  KUGOU_ACG_HISTORY_PROGRESS_KEY,
  KUGOU_ACG_HISTORY_VIEW_KEY,
} from '../src/kugou-acg-chart-history.js';

function r2Store() {
  const values = new Map();
  return {
    values,
    binding: {
      async get(key) {
        if (!values.has(key)) return null;
        return { async json() { return structuredClone(values.get(key)); } };
      },
      async put(key, body) {
        values.set(key, JSON.parse(body));
      },
    },
  };
}

function kugouFetch() {
  return async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/rank/vol')) {
      return {
        ok: true,
        async json() {
          return {
            status: 1,
            errcode: 0,
            data: { info: [{ year: 2026, vols: [
              { volid: '103', volname: '20261001' },
              { volid: '102', volname: '20260924' },
              { volid: '101', volname: '20260917' },
            ] }] },
          };
        },
      };
    }
    const volid = url.searchParams.get('volid');
    return {
      ok: true,
      async json() {
        return {
          status: 1,
          errcode: 0,
          data: { info: [{ filename: `櫻坂46 - song-${volid}`, album_audio_id: Number(volid) }] },
        };
      },
    };
  };
}

test('Kugou ACG backfill stores resumable batches and completes on the next batch', async () => {
  const store = r2Store();
  const env = { PAGES_RESPONSE_R2: store.binding };
  const fetchImpl = kugouFetch();

  const first = await runKugouAcgBackfillBatch(env, {
    startDate: '2026-09-01', batchSize: 2, now: 1000,
  }, fetchImpl);
  assert.equal(first.complete, false);
  assert.equal(first.fetched_this_batch, 2);
  assert.equal(first.remaining, 1);
  assert.equal(store.values.get(KUGOU_ACG_HISTORY_INDEX_KEY).weeks['2026_40'].volid, '103');
  assert.equal(store.values.get(KUGOU_ACG_HISTORY_VIEW_KEY).history.length, 2);
  assert.equal(store.values.get(KUGOU_ACG_HISTORY_PROGRESS_KEY).status, 'running');

  const second = await runKugouAcgBackfillBatch(env, {
    startDate: '2026-09-01', batchSize: 2, now: 2000,
  }, fetchImpl);
  assert.equal(second.complete, true);
  assert.equal(second.fetched_this_batch, 1);
  assert.equal(second.remaining, 0);
  assert.equal(second.stored_periods, 3);
  assert.equal(second.history_entries, 3);
  assert.equal(store.values.get(KUGOU_ACG_HISTORY_PROGRESS_KEY).status, 'complete');
});

test('regional queue publishes each Kugou ACG batch and queues continuation before ack', async () => {
  let acked = false;
  let published = 0;
  const continuation = [];
  const message = {
    body: {
      message_type: KUGOU_ACG_BACKFILL_MESSAGE_TYPE,
      start_date: '2019-01-01',
      batch_size: 4,
      requested_at: 123,
    },
    ack() { acked = true; },
  };

  const result = await runRegionalMusicServiceQueue(
    { messages: [message] },
    {},
    {},
    {
      runBackfill: async () => ({ complete: false, remaining: 4, fetched_this_batch: 4 }),
      publishReadModel: async (_env, service) => {
        assert.equal(service, 'kugou_music');
        published += 1;
      },
      sendContinuation: async (body) => continuation.push(body),
    },
  );

  assert.equal(result.complete, false);
  assert.equal(published, 1);
  assert.equal(continuation.length, 1);
  assert.equal(continuation[0].message_type, KUGOU_ACG_BACKFILL_MESSAGE_TYPE);
  assert.equal(continuation[0].start_date, '2019-01-01');
  assert.equal(acked, true);
});

test('completed Kugou ACG backfill publishes without another queue message', async () => {
  let acked = false;
  let continuations = 0;
  const message = {
    body: { message_type: KUGOU_ACG_BACKFILL_MESSAGE_TYPE },
    ack() { acked = true; },
  };
  await runRegionalMusicServiceQueue(
    { messages: [message] },
    {},
    {},
    {
      runBackfill: async () => ({ complete: true, remaining: 0, fetched_this_batch: 0 }),
      publishReadModel: async () => {},
      sendContinuation: async () => { continuations += 1; },
    },
  );
  assert.equal(continuations, 0);
  assert.equal(acked, true);
});
