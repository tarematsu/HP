import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { TRACK_HISTORY_DAY_INDEX_KEY, trackHistoryDayIndexKey } from '../worker/src/pages-track-history-day-index.js';
import { loadTrackHistoryR2ApiResponse } from '../worker/src/pages-track-history-r2-api.js';
import { trackHistoryDayObjectKey } from '../worker/src/pages-track-history-r2-shards.js';
import { pagesR2ResponseKey } from '../worker/src/pages-response-r2.js';
import { stationheadLikesModelKey } from '../worker/src/stationhead-likes-read-model.js';

class FakeR2 {
  constructor(entries = {}) {
    this.entries = new Map(Object.entries(entries));
    this.gets = [];
  }

  async get(key) {
    this.gets.push(key);
    if (!this.entries.has(key)) return null;
    const value = this.entries.get(key);
    return {
      async json() { return structuredClone(value); },
      async text() { return JSON.stringify(value); },
    };
  }
}

const DAY_21 = {
  version: 1,
  day: '2026-09-21',
  updated_at: 100,
  rows: [{ play_date: '2026-09-21', title: 'A', artist: '櫻坂46', play_count: 3 }],
};
const DAY_22 = {
  version: 1,
  day: '2026-09-22',
  updated_at: 200,
  rows: [{ play_date: '2026-09-22', title: 'B', artist: '櫻坂46', play_count: 4 }],
};

function fakeR2() {
  return new FakeR2({
    [TRACK_HISTORY_DAY_INDEX_KEY]: {
      version: 1,
      updated_at: 200,
      dates: ['2026-09-21', '2026-09-22'],
      latest_date: '2026-09-22',
    },
    [trackHistoryDayObjectKey('2026-09-21')]: DAY_21,
    [trackHistoryDayObjectKey('2026-09-22')]: DAY_22,
  });
}

test('Track History date navigation reads only the R2 day index', async () => {
  const r2 = fakeR2();
  const response = await loadTrackHistoryR2ApiResponse(
    r2,
    new Request('https://internal/_internal/pages-response?key=track-history&api=1&dates_only=1'),
    1_000,
  );
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).dates, ['2026-09-21', '2026-09-22']);
  assert.deepEqual(r2.gets, [TRACK_HISTORY_DAY_INDEX_KEY]);
});

test('Track History range reads the index and selected R2 day objects without D1', async () => {
  const r2 = fakeR2();
  const response = await loadTrackHistoryR2ApiResponse(
    r2,
    new Request('https://internal/_internal/pages-response?key=track-history&api=1&from=2026-09-21&to=2026-09-22&limit=10000&ranking=0'),
    1_000,
  );
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.read_path, 'r2-track-history-day-read-model');
  assert.equal(payload.rows.length, 2);
  assert.equal(payload.rows.reduce((sum, row) => sum + row.play_count, 0), 7);
  assert.deepEqual(r2.gets, [
    TRACK_HISTORY_DAY_INDEX_KEY,
    trackHistoryDayObjectKey('2026-09-21'),
    trackHistoryDayObjectKey('2026-09-22'),
  ]);
});

test('missing ranking model fails instead of reporting an empty ranking as success', async () => {
  const r2 = fakeR2();
  const response = await loadTrackHistoryR2ApiResponse(
    r2,
    new Request('https://internal/api/track-history?ranking_only=1'),
    1_000,
  );
  assert.equal(response.status, 503);
  assert.equal((await response.json()).ok, false);
  assert.ok(r2.gets.includes(pagesR2ResponseKey(stationheadLikesModelKey('buddies'))));
  assert.ok(r2.gets.includes(pagesR2ResponseKey('track-history-status')));
  assert.ok(r2.gets.includes(pagesR2ResponseKey('track-history')));
});

test('regular Track History response also fails closed when its ranking model is missing', async () => {
  const r2 = fakeR2();
  const response = await loadTrackHistoryR2ApiResponse(
    r2,
    new Request('https://internal/api/track-history?from=2026-09-21&to=2026-09-22'),
    1_000,
  );
  assert.equal(response.status, 503);
  assert.equal((await response.json()).ok, false);
  assert.ok(r2.gets.includes(pagesR2ResponseKey('track-history-status')));
  assert.ok(r2.gets.includes(pagesR2ResponseKey('track-history')));
});

test('Likes reads the canonical ranking model without requiring the full history object', async () => {
  const calls = [];
  const statusKey = pagesR2ResponseKey('track-history-status');
  const response = await loadTrackHistoryR2ApiResponse({
    async get(key) {
      calls.push(key);
      return key === statusKey ? {
        body: {},
        async json() {
          return {
            version: 1, status: 200, updated_at: 1_000,
            body: JSON.stringify({
              ok: true,
              ranking: [{ title: 'Song A', latest_like_count: 42 }],
              ranking_summary: { track_count: 1, max_like_count: 42 },
              generated_at: 1_000,
            }),
          };
        },
      } : null;
    },
  }, new Request('https://internal/api/track-history?ranking_only=1'), 1_000);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).ranking[0].title, 'Song A');
  assert.equal(calls.at(-1), statusKey);
  assert.ok(!calls.includes(pagesR2ResponseKey('track-history')));
});

test('Ohisama likes use the source-scoped Stationhead likes model', async () => {
  const calls = [];
  const response = await loadTrackHistoryR2ApiResponse(
    {},
    new Request('https://internal/api/track-history?source=ohisama&ranking_only=1&ranking_limit=500'),
    1_000,
    Number.MAX_SAFE_INTEGER,
    {
      async loadLikesResponse(_r2, key) {
        calls.push(key);
        return new Response(JSON.stringify({
          ok: true,
          source: 'ohisama',
          updated_at: 900,
          ranking: [{ track_id: 1, title: 'Song H', artist: '日向坂46', like_count: 55, observed_at: 900 }],
          ranking_summary: { track_count: 1, latest_observed_at: 900 },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      },
    },
  );
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.source, 'ohisama');
  assert.equal(payload.ranking[0].like_count, 55);
  assert.equal(payload.read_path, 'r2-stationhead-likes-read-model');
  assert.deepEqual(calls, [stationheadLikesModelKey('ohisama')]);
});

test('Pages middleware routes Track History to R2 and fail-closes instead of falling back to D1', () => {
  const source = readFileSync(new URL('../site/functions/_middleware.js', import.meta.url), 'utf8');
  assert.match(source, /TRACK_HISTORY_MODEL_KEY = 'track-history'/);
  assert.match(source, /SERVICE_MATERIALIZED_MODEL_KEYS[\s\S]*TRACK_HISTORY_MODEL_KEY/);
  assert.match(source, /pathname === '\/api\/track-history' \? TRACK_HISTORY_MODEL_KEY/);
  assert.match(source, /url\.searchParams\.set\('api', '1'\)/);
  assert.match(source, /return materializedUnavailable\(modelKey\);/);
  assert.doesNotMatch(source, /LIVE_PAGES_FALLBACK_MODEL_KEYS|x-materialized-fallback|pages_live_fallback_unavailable/);
});


test('Ohisama Track History uses the same API contract with source-scoped R2 days', async () => {
  const indexKey = trackHistoryDayIndexKey('ohisama');
  const dayKey = trackHistoryDayObjectKey('2026-10-02', 'ohisama');
  const r2 = new FakeR2({
    [indexKey]: {
      version: 1,
      updated_at: 300,
      dates: ['2026-10-02'],
      latest_date: '2026-10-02',
      play_counts: { '2026-10-02': 319 },
    },
    [dayKey]: {
      version: 1,
      day: '2026-10-02',
      updated_at: 300,
      source_row_count: 319,
      rows: [{ play_date: '2026-10-02', track_id: 1, title: 'A', artist: '日向坂46', play_count: 319 }],
    },
  });
  const response = await loadTrackHistoryR2ApiResponse(
    r2,
    new Request('https://internal/api/track-history?source=ohisama&from=2026-10-02&to=2026-10-02&ranking=0'),
    1_000,
  );
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.source, 'ohisama');
  assert.equal(payload.rows[0].play_count, 319);
  assert.equal(payload.ranking_included, false);
  assert.deepEqual(r2.gets, [indexKey, dayKey]);
});
