import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { TRACK_HISTORY_DAY_INDEX_KEY } from '../worker/src/pages-track-history-day-index.js';
import { loadTrackHistoryR2ApiResponse } from '../worker/src/pages-track-history-r2-api.js';
import { trackHistoryDayObjectKey } from '../worker/src/pages-track-history-r2-shards.js';
import { pagesActionsR2ResponseKey } from '../worker/src/pages-response-r2.js';

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
  assert.deepEqual(r2.gets, [
    pagesActionsR2ResponseKey('track-history-status'),
    'pages-response/v1/track-history-status.json',
    'pages-response/v1/track-history.json',
  ]);
});

test('Likes reads ranking published by scheduled Actions without the full history object', async () => {
  const calls = [];
  const statusKey = pagesActionsR2ResponseKey('track-history-status');
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
  assert.deepEqual(calls, [statusKey]);
});

test('Pages middleware routes Track History to R2 and fail-closes instead of falling back to D1', () => {
  const source = readFileSync(new URL('../site/functions/_middleware.js', import.meta.url), 'utf8');
  assert.match(source, /TRACK_HISTORY_MODEL_KEY = 'track-history'/);
  assert.match(source, /SERVICE_MATERIALIZED_MODEL_KEYS[\s\S]*TRACK_HISTORY_MODEL_KEY/);
  assert.match(source, /pathname === '\/api\/track-history' \? TRACK_HISTORY_MODEL_KEY/);
  assert.match(source, /url\.searchParams\.set\('api', '1'\)/);
  assert.match(source, /const LIVE_PAGES_FALLBACK_MODEL_KEYS = new Set\(\)/);
});
