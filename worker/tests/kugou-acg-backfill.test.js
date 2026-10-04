import assert from 'node:assert/strict';
import test from 'node:test';

import {
  KUGOU_ACG_BACKFILL_MESSAGE_TYPE,
  runRegionalMusicServiceQueue,
} from '../src/regional-music-service-entry.js';
import {
  KUGOU_ACG_HISTORICAL_FETCH_VERSION,
  kugouAcgHistoricalSongsUrl,
  runKugouAcgBackfillBatch,
} from '../src/kugou-acg-backfill.js';
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

function tagged(payload) {
  return `<!--KG_TAG_RES_START-->${JSON.stringify(payload)}<!--KG_TAG_RES_END-->`;
}

function kugouFetch(requests = []) {
  return async (input) => {
    const url = new URL(String(input));
    requests.push(url);
    if (url.pathname.endsWith('/rank/vol')) {
      const payload = {
        status: 1,
        errcode: 0,
        data: { info: [{ year: 2026, vols: [
          { volid: '103', volname: '20261001' },
          { volid: '102', volname: '20260924' },
          { volid: '101', volname: '20260917' },
        ] }] },
      };
      return { ok: true, async text() { return tagged(payload); } };
    }
    const volid = url.searchParams.get('volid');
    const payload = {
      status: 1,
      errcode: 0,
      data: { info: [{ authors:[{ author_name:'松田里奈' }], songname:'ピッカーン！', album_audio_id: Number(volid) }] },
    };
    return { ok: true, async text() { return tagged(payload); } };
  };
}

test('historical Kugou ACG song URL selects the requested volume mode', () => {
  const url = new URL(kugouAcgHistoricalSongsUrl('126794'));
  assert.equal(url.protocol, 'http:');
  assert.equal(url.hostname, 'mobilecdnbj.kugou.com');
  assert.equal(url.searchParams.get('rankid'), '33162');
  assert.equal(url.searchParams.get('volid'), '126794');
  assert.equal(url.searchParams.get('ranktype'), '0');
  assert.equal(url.searchParams.get('with_res_tag'), '0');
  assert.equal(url.searchParams.get('area_code'), '1');
  assert.equal(url.searchParams.get('show_portrait_mv'), '1');
});

test('Kugou ACG backfill stores tagged provider responses in resumable historical batches', async () => {
  const store = r2Store();
  const requests = [];
  const env = { PAGES_RESPONSE_R2: store.binding };
  const fetchImpl = kugouFetch(requests);

  const first = await runKugouAcgBackfillBatch(env, {
    startDate: '2026-09-01', batchSize: 2, now: 1000,
  }, fetchImpl);
  assert.equal(first.complete, false);
  assert.equal(first.fetched_this_batch, 2);
  assert.equal(first.remaining, 1);
  assert.equal(first.historical_fetch_version, KUGOU_ACG_HISTORICAL_FETCH_VERSION);
  assert.equal(store.values.get(KUGOU_ACG_HISTORY_INDEX_KEY).weeks['2026_40'].volid, '103');
  assert.equal(store.values.get(KUGOU_ACG_HISTORY_INDEX_KEY).weeks['2026_40'].historical_fetch_version, KUGOU_ACG_HISTORICAL_FETCH_VERSION);
  assert.equal(store.values.get(KUGOU_ACG_HISTORY_VIEW_KEY).history.length, 2);
  assert.equal(store.values.get(KUGOU_ACG_HISTORY_PROGRESS_KEY).status, 'running');
  assert.ok(requests.filter((url) => url.pathname.endsWith('/rank/song')).every((url) => url.searchParams.get('ranktype') === '0'));

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

test('Kugou ACG backfill refreshes periods saved by the previous matching version', async () => {
  const store = r2Store();
  store.values.set(KUGOU_ACG_HISTORY_INDEX_KEY, {
    version:1,
    weeks:{
      '2026_40':{ period:'2026_40', volid:'103', entries:0, historical_fetch_version:2 },
      '2026_39':{ period:'2026_39', volid:'102', entries:0, historical_fetch_version:2 },
      '2026_38':{ period:'2026_38', volid:'101', entries:0, historical_fetch_version:2 },
    },
  });
  store.values.set(KUGOU_ACG_HISTORY_VIEW_KEY, { version:1, history:[] });
  const requests = [];
  const result = await runKugouAcgBackfillBatch(
    { PAGES_RESPONSE_R2: store.binding },
    { startDate:'2026-09-01', batchSize:3, now:3000 },
    kugouFetch(requests),
  );
  assert.equal(result.complete, true);
  assert.equal(result.fetched_this_batch, 3);
  assert.equal(result.history_entries, 3);
  assert.equal(requests.filter((url) => url.pathname.endsWith('/rank/song')).length, 3);
  assert.ok(Object.values(store.values.get(KUGOU_ACG_HISTORY_INDEX_KEY).weeks)
    .every((row) => row.historical_fetch_version === KUGOU_ACG_HISTORICAL_FETCH_VERSION));
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

test('failed Kugou ACG queue batches persist diagnostics before retry', async () => {
  const store = r2Store();
  let acked = false;
  const message = {
    body: {
      message_type: KUGOU_ACG_BACKFILL_MESSAGE_TYPE,
      start_date: '2019-01-01',
      requested_at: 123,
    },
    ack() { acked = true; },
  };

  await assert.rejects(() => runRegionalMusicServiceQueue(
    { messages: [message] },
    { PAGES_RESPONSE_R2: store.binding },
    {},
    {
      runBackfill: async () => { throw new TypeError('fetch failed'); },
      publishReadModel: async () => { throw new Error('must not publish'); },
      sendContinuation: async () => { throw new Error('must not continue'); },
    },
  ), /fetch failed/);

  const progress = store.values.get(KUGOU_ACG_HISTORY_PROGRESS_KEY);
  assert.equal(progress.status, 'error');
  assert.equal(progress.complete, false);
  assert.equal(progress.start_date, '2019-01-01');
  assert.equal(progress.requested_at, 123);
  assert.match(progress.last_error, /fetch failed/);
  assert.equal(acked, false);
});