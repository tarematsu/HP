import assert from 'node:assert/strict';
import test from 'node:test';
import { refreshAmazonModel } from '../scripts/refresh-amazon-music-actions.mjs';
import { continueAmazonDaily50kScan, AMAZON_MUSIC_DAILY_SCAN_STATE_KEY } from '../src/amazon-music-daily-50k.js';
test('late continuation retries cannot rewind a newer scan or its progress', async () => {
  const state = { status: 'active', started_at: 1500, updated_at: 2000, scanned_tracks: 20_000 };
  const original = JSON.stringify(state);
  const env = { PAGES_RESPONSE_R2: {
    get: async () => ({ json: async () => JSON.parse(original) }),
    put: async () => assert.fail('late retry must not replace current progress'),
  } };
  for (const observedAt of [1000, 1800]) {
    const result = await continueAmazonDaily50kScan(env, observedAt, () => assert.fail('late retry must not fetch'));
    assert.equal(result.reason, 'stale-scan-trigger');
  }
});
test('manual recollection publishes only a complete fresh scan and never relabels old observations', async () => {
  const now = 1000;
  let scans = 0;
  const result = await refreshAmazonModel({ PAGES_RESPONSE_R2: { async get() { return { json: async () => ({ observed_at: now, tracks: [{ group_name: '櫻坂46', amazon_rank: 46 }] }) }; } } }, {
    now, dependencies: { async collect() { scans++; return { complete: true, published: { published: true } }; } },
  });
  assert.equal(scans, 1);
  assert.equal(result.published, true);
  assert.equal(result.groups['櫻坂46'], 1);
  await assert.rejects(refreshAmazonModel({}, { now, dependencies: { collect: async () => ({ complete: false }) } }), /complete scan/);
});

test('a successful incomplete batch continues before the fresh model is checked', async () => {
  let continued = 0;
  const now = 1000;
  const result = await refreshAmazonModel({ PAGES_RESPONSE_R2: {
    get: async () => ({ json: async () => ({ observed_at: now, tracks: [] }) }),
  } }, { now, dependencies: {
    collect: async () => ({ ok: true, skipped: false, complete: false, scanned_tracks: 49_950 }),
    continue: async (_env, observedAt) => {
      assert.equal(observedAt, now);
      continued++;
      return { complete: true, published: { published: true } };
    },
  } });
  assert.equal(result.published, true);
  assert.equal(continued, 1);
});

test('recovery preserves collection failure details', async () => {
  await assert.rejects(refreshAmazonModel({}, {}), /PAGES_RESPONSE_R2 binding is required/);
});

test('recollection continues through three batches and refuses a stuck cursor', async () => {
  let calls = 0;
  const env = { PAGES_RESPONSE_R2: { get: async () => ({ json: async () => ({ observed_at: 1000, tracks: [] }) }) } };
  const collect = async () => ({ ok: true, skipped: false, complete: false, scanned_tracks: 20_000 });
  const continuation = async () => ++calls === 1
    ? { ok: true, skipped: false, complete: false, scanned_tracks: 40_000 }
    : { complete: true, published: { published: true } };
  await refreshAmazonModel(env, { now: 1000, dependencies: { collect, continue: continuation } });
  assert.equal(calls, 2);
  await assert.rejects(refreshAmazonModel(env, { now: 1000, dependencies: { collect, continue: collect } }), /no progress/);
});

test('completed scan publication retries from durable state without fetching the provider', async () => {
  const state = { complete: true, status: 'complete', publication_pending: true, updated_at: 1000, scan_id: 'scan', scanned_tracks: 50_000, cycle_tracks: [] };
  const objects = new Map([[AMAZON_MUSIC_DAILY_SCAN_STATE_KEY, JSON.stringify(state)]]);
  let fail = true;
  const env = { PAGES_RESPONSE_R2: {
    get: async (key) => objects.has(key) ? { json: async () => JSON.parse(objects.get(key)) } : null,
    put: async (key, body) => { if (key.includes('pages-responses') && fail) throw new Error('write failed'); objects.set(key, body); },
  } };
  // Fail the first public response write, wherever its encoded key is stored.
  const originalPut = env.PAGES_RESPONSE_R2.put;
  env.PAGES_RESPONSE_R2.put = async (key, body) => { if (key !== 'amazon-music/read-model/latest.json' && key !== AMAZON_MUSIC_DAILY_SCAN_STATE_KEY && fail) throw new Error('write failed'); return originalPut(key, body); };
  const fetchImpl = () => { throw new Error('must not recollect'); };
  await assert.rejects(continueAmazonDaily50kScan(env, 2000, fetchImpl), /write failed/);
  assert.equal(JSON.parse(objects.get(AMAZON_MUSIC_DAILY_SCAN_STATE_KEY)).publication_pending, true);
  fail = false;
  const result = await continueAmazonDaily50kScan(env, 3000, fetchImpl);
  assert.equal(result.published.published, true);
  assert.equal(JSON.parse(objects.get('amazon-music/read-model/latest.json')).observed_at, 1000);
  assert.equal(JSON.parse(objects.get(AMAZON_MUSIC_DAILY_SCAN_STATE_KEY)).publication_pending, false);
});


test('manual recovery republishes a recent durable scan without recollecting or inventing freshness', async () => {
  const state = { started_at: 1000, updated_at: 1000, complete: true, publication_pending: true, status: 'complete', scanned_tracks: 50_000, scan_id: 'saved', cycle_tracks: [] };
  const objects = new Map([[AMAZON_MUSIC_DAILY_SCAN_STATE_KEY, JSON.stringify(state)]]);
  const env = { PAGES_RESPONSE_R2: {
    get: async key => objects.has(key) ? { json: async () => JSON.parse(objects.get(key)) } : null,
    put: async (key, value) => objects.set(key, value),
  } };
  const result = await refreshAmazonModel(env, { now: 2000 });
  assert.equal(result.published, true);
  assert.equal(JSON.parse(objects.get('amazon-music/read-model/latest.json')).observed_at, 1000);
  assert.equal(JSON.parse(objects.get(AMAZON_MUSIC_DAILY_SCAN_STATE_KEY)).publication_pending, false);
});
