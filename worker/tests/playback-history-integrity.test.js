import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { stationheadCompletedDailyStatement } from '../src/stationhead-playback-store.js';
import { publishStationheadPlaybackDay } from '../src/stationhead-playback-publication.js';
import { mergeRetainedPlaybackTracks, rebuildOhisamaTrackHistory } from '../scripts/rebuild-ohisama-track-history-actions.mjs';

test('a newer partial replay cannot replace a complete D1 playback day', () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('CREATE TABLE sh_track_daily_summary(period_key TEXT PRIMARY KEY,total_plays INTEGER,unique_tracks INTEGER,tracks_json TEXT,updated_at INTEGER)');
  const db = { prepare(sql) { return { bind(...args) { return { run() { return sqlite.prepare(sql).run(...args); } }; } }; } };
  const daily = (count) => ({ period_key: '2026-10-06', total_plays: count, tracks: { a: { track_id: 1, count } } });
  stationheadCompletedDailyStatement(db, daily(330), 100).run();
  stationheadCompletedDailyStatement(db, daily(1), 200).run();
  assert.equal(sqlite.prepare('SELECT total_plays FROM sh_track_daily_summary').get().total_plays, 330);
  stationheadCompletedDailyStatement(db, daily(331), 300).run();
  assert.equal(sqlite.prepare('SELECT total_plays FROM sh_track_daily_summary').get().total_plays, 331);
  sqlite.close();
});

test('partial hot-state recovery cannot truncate an already published R2 day', async () => {
  const bucket = {
    async get() { return { async json() { return { version: 1, day: '2026-10-06', rows: [], source_row_count: 330 }; } }; },
    async put() { assert.fail('complete day must not be overwritten'); },
  };
  const result = await publishStationheadPlaybackDay(bucket, 'ohisama', {
    period_key: '2026-10-06', total_plays: 1, tracks: [{ track_id: 1, count: 1 }],
  }, 200);
  assert.equal(result.reason, 'retained_more_complete_day');
});

test('retained facts restore truncated tracks without summing duplicate or expired facts', () => {
  const restored = mergeRetainedPlaybackTracks(
    [{ track_id: 1, count: 1 }, { track_id: 2, count: 30 }],
    [{ track_id: 1, count: 20 }, { track_id: 2, count: 10 }, { track_id: 3, count: 4 }],
  );
  assert.deepEqual(restored.map((row) => row.count), [20, 30, 4]);
});

test('repair durably restores missing and truncated summaries before R2 publication', async () => {
  const writes = [];
  const objects = new Map();
  const at = Date.parse('2026-10-06T23:00:00Z');
  const db = { prepare(sql) { return { bind(...args) { return {
    async all() { return { results: sql.includes('FROM sh_track_daily_summary')
      ? [{ period_key: '2026-10-06', total_plays: 1, tracks_json: '[{"track_id":1,"count":1}]', updated_at: at }]
      : [{ period_key: '2026-10-06', track_id: 1, count: 20, updated_at: at },
        { period_key: '2026-10-07', track_id: 1, count: 10, updated_at: at + 86_400_000 }] }; },
    async run() { writes.push(args); },
  }; } }; } };
  const r2 = {
    async get(key) { return objects.has(key) ? { async json() { return JSON.parse(objects.get(key)); } } : null; },
    async put(key, value) {
      assert.equal(writes.length, 2, 'both recovered D1 days must survive raw-fact expiry');
      objects.set(key, value);
    },
  };
  await rebuildOhisamaTrackHistory({ db, r2, fromDay: '2026-10-06' });
  assert.deepEqual(writes.map((args) => args.slice(0, 2)), [['2026-10-06', 20], ['2026-10-07', 10]]);
  assert.equal(writes[0].at(-1), at, 'repair must retain the source observation time');
});
