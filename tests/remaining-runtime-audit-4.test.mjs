import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { loadTrackHistoryData } from '../site/functions/lib/track-history-handler.js';
import { loadSakurazakaSeriesRows } from '../site/functions/api/sakurazaka46jp.js';

test('track history and compact realtime likes share one D1 batch', async () => {
  let batchCalls = 0;
  let allCalls = 0;
  const statements = [];
  const db = {
    prepare(sql) {
      const statement = {
        sql,
        values: [],
        bind(...values) { this.values = values; return this; },
        async all() { allCalls += 1; return { results: [] }; },
      };
      statements.push(statement);
      return statement;
    },
    async batch(items) {
      batchCalls += 1;
      assert.equal(items.length, 2);
      return [
        { results: [{ play_date: '2026-07-01', play_count: 1 }] },
        { results: [{ play_date: '2026-07-01', spotify_id: 'track-1', like_count: 3, observed_at: 300, source: 'collector' }] },
      ];
    },
  };

  const loaded = await loadTrackHistoryData(db, 0, 86400000, 100, true);
  assert.equal(batchCalls, 1);
  assert.equal(allCalls, 0);
  assert.equal(statements.length, 2);
  assert.equal(loaded.result.results[0].play_count, 1);
  assert.equal(loaded.likeRows.length, 1);
  assert.equal(loaded.likeRows[0].like_count, 3);
  assert.equal(loaded.likeRows[0].source, 'collector');
});

test('Sakurazaka series reads canonical OTHER_DB history without request-time minute reconstruction', async () => {
  let minuteCalls = 0;
  let otherCalls = 0;
  const minuteDb = {
    prepare() {
      minuteCalls += 1;
      throw new Error('Pages must not reconstruct official series from MINUTE_DB');
    },
  };
  const otherDb = {
    prepare(sql) {
      return {
        bind() { return this; },
        async all() {
          otherCalls += 1;
          if (sql.includes('sh_official_broadcast_series')) {
            return { results: [{
              event_name: 'A', started_at: 100,
              points_json: '[[0,30,1]]', point_count: 1, total_points: 1,
              source: 'google_sheets_canonical',
            }] };
          }
          if (sql.includes('FROM sh_official_broadcast_summary')) {
            return { results: [
              { event_name: 'A', started_at: 100, ended_at: 200 },
              { event_name: 'C', started_at: 300, ended_at: 400 },
            ] };
          }
          throw new Error(`unexpected request-time query: ${sql}`);
        },
      };
    },
  };

  const loaded = await loadSakurazakaSeriesRows(minuteDb, otherDb, 0, 1000);
  assert.equal(minuteCalls, 0);
  assert.equal(otherCalls, 2);
  assert.equal(loaded.historical.length, 2);
  assert.equal(loaded.historical[0].source, 'google_sheets_canonical');
  assert.equal(loaded.historical[0].samples[0].listener, 30);
  assert.equal(loaded.historical[1].source, 'historical_summary_only');
  assert.deepEqual(loaded.historical[1].samples, []);
  assert.deepEqual(loaded.failSafe, []);
});

test('history client owns table formatting and cache while charts are mode-specific', () => {
  const source = readFileSync(
    new URL('../site/public/history/history-lite.js', import.meta.url),
    'utf8',
  );
  assert.match(source, /const integer = new Intl\.NumberFormat/);
  assert.match(source, /const dateOnly = new Intl\.DateTimeFormat/);
  assert.match(source, /function renderTable/);
  assert.match(source, /function publishHistoryData/);
  assert.match(source, /history:data-loaded/);
  assert.match(source, /sessionStorage\.getItem/);
  assert.match(source, /sessionStorage\.setItem/);
  assert.doesNotMatch(source, /function drawSummaryChart|function prepareCanvas|chartModel|broadcast-series|history-current|mode === 'raw'/);
  assert.doesNotMatch(source, /TRACK_COLUMNS|trackDate|trackWeekMode|mode === 'tracks'/);
});
