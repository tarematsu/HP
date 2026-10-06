import assert from 'node:assert/strict';
import test from 'node:test';
import { aggregatePlayed, loadPlayed, trackIdentity } from '../public/stationhead/played-tracks.js';
globalThis.localStorage = { getItem: () => null, removeItem() {} };
globalThis.window = { fetch: globalThis.fetch };
const { loadDashboardJson } = await import('../public/dashboard-data-client.js');
import { weekStart } from '../public/stationhead/view-utils.js';

function runtime(weekly = false) {
  return {
    root: { hidden: false, querySelector: selector => selector.includes('played-week') ? { checked: weekly } : null },
    section: 'played-tracks', playedSequence: 0, playedDates: [], playedPeriod: '',
    model: { loadPlayedIndex: async () => ['2026-09-29', '2026-10-04'], loadPlayedPeriod: async () => [] },
  };
}

test('canonical identity merges provider variants without merging different songs', () => {
  const rows = aggregatePlayed([
    { track_id: 1, spotify_id: 'a', title: 'song', play_count: 2 },
    { track_id: 1, spotify_id: 'b', title: 'song', play_count: 3 },
    { track_id: 2, title: 'song', play_count: 4 },
    { track_id: 3, play_count: -1 },
  ]);
  assert.deepEqual(rows.map(row => [row.track_id, row.play_count]), [[1, 5], [2, 4]]);
  assert.notEqual(trackIdentity({ title: 'song', artist: 'A' }), trackIdentity({ title: 'song', artist: 'B' }));
});

test('weekly period requests deduplicate dates and span Monday through Sunday', async () => {
  const view = runtime(true);
  const requests = [];
  view.model.loadPlayedPeriod = async (...args) => { requests.push(args); return []; };
  await loadPlayed(view);
  assert.equal(view.playedPeriod, weekStart('2026-10-04'));
  assert.deepEqual(requests, [['2026-09-28', '2026-10-04', { force: false }]]);
});

test('leaving the playback panel during an index request prevents subsequent period reads', async () => {
  const view = runtime();
  let finish;
  let periodReads = 0;
  view.model.loadPlayedIndex = () => new Promise(resolve => { finish = resolve; });
  view.model.loadPlayedPeriod = async () => { periodReads++; return []; };
  const pending = loadPlayed(view);
  view.section = 'likes';
  finish(['2026-10-04']);
  await pending;
  assert.equal(periodReads, 0);
});

test('concurrent reads share one request and a failed read can retry', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  let finish;
  try {
    globalThis.fetch = async () => {
      calls += 1;
      return new Promise(resolve => { finish = resolve; });
    };
    const url = '/api/test-shared-read-model-concurrency';
    const first = loadDashboardJson(url);
    const second = loadDashboardJson(url);
    await Promise.resolve();
    finish(Response.json({ ok: true, value: 42 }));
    assert.deepEqual(await Promise.all([first, second]), [{ ok: true, value: 42 }, { ok: true, value: 42 }]);
    assert.equal(calls, 1);
    assert.deepEqual(await loadDashboardJson(url), { ok: true, value: 42 });

    let attempts = 0;
    globalThis.fetch = async () => {
      attempts += 1;
      if (attempts === 1) return Response.json({ ok: false, error: 'temporary' }, { status: 503 });
      return Response.json({ ok: true, rows: [] });
    };
    const retryUrl = '/api/test-shared-read-model-retry';
    await assert.rejects(loadDashboardJson(retryUrl), /temporary/);
    assert.deepEqual(await loadDashboardJson(retryUrl), { ok: true, rows: [] });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
