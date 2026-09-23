import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import {
  BROADCAST_READ_MODEL_SQL,
  BROADCAST_SUMMARY_SQL,
  parseBroadcastSummaryRows,
} from '../functions/api/history.js';

function createSummaryTable(db) {
  db.exec(`CREATE TABLE sh_official_broadcast_summary (
    host_handle TEXT NOT NULL,
    event_name TEXT NOT NULL,
    started_at INTEGER,
    ended_at INTEGER,
    started_jst TEXT,
    ended_jst TEXT,
    sample_count INTEGER NOT NULL DEFAULT 0,
    listener_avg REAL,
    listener_max INTEGER,
    likes_max INTEGER,
    distinct_tracks INTEGER,
    PRIMARY KEY(host_handle,event_name)
  )`);
}

test('broadcast history reads UTC timestamps from the compact official summary table', () => {
  const db = new DatabaseSync(':memory:');
  createSummaryTable(db);
  db.prepare(`INSERT INTO sh_official_broadcast_summary VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
    'sakurazaka46jp', 'Event A', 1000, 2000, '2025-01-01 09:00:01',
    '2025-01-01 09:00:02', 2, 110, 120, 12, 2,
  );

  const rows = db.prepare(BROADCAST_SUMMARY_SQL).all(0, 3000, 0, 3000);
  const parsed = parseBroadcastSummaryRows(rows);

  assert.equal(parsed.setupRequired, false);
  assert.deepEqual(parsed.rows, [{
    event_name: 'Event A',
    started_at: 1000,
    ended_at: 2000,
    sample_count: 2,
    listener_avg: 110,
    listener_max: 120,
    likes_max: 12,
    distinct_tracks: 2,
    host_handle: 'sakurazaka46jp',
    source_url: null,
    estimated_streams: 220,
  }]);
});

test('official listening-party read model joins the nearest host session and snapshot minimum', () => {
  const db = new DatabaseSync(':memory:');
  createSummaryTable(db);
  db.exec(`
    CREATE TABLE sh_host_broadcast_sessions (
      id INTEGER PRIMARY KEY,handle TEXT,started_at INTEGER,ended_at INTEGER,
      average_listeners REAL,peak_listeners INTEGER,track_count INTEGER,comment_count INTEGER
    );
    CREATE TABLE sh_host_station_snapshots (
      id INTEGER PRIMARY KEY,session_id INTEGER,listener_count INTEGER
    );
  `);
  db.prepare(`INSERT INTO sh_official_broadcast_summary VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
    'sakurazaka46jp', 'Event A', 1_000_000, null, '2025-01-01 09:00:01',
    null, 2, null, null, 12, null,
  );
  db.prepare(`INSERT INTO sh_host_broadcast_sessions VALUES(?,?,?,?,?,?,?,?)`).run(
    7, 'sakurazaka46jp', 1_000_600, 1_090_000, 111.5, 150, 4, 321,
  );
  db.prepare(`INSERT INTO sh_host_station_snapshots VALUES(?,?,?)`).run(1, 7, 98);
  db.prepare(`INSERT INTO sh_host_station_snapshots VALUES(?,?,?)`).run(2, 7, 150);

  const rows = db.prepare(BROADCAST_READ_MODEL_SQL).all(0, 2_000_000);
  const parsed = parseBroadcastSummaryRows(rows);

  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0].session_id, 7);
  assert.equal(parsed.rows[0].ended_at, 1_090_000);
  assert.equal(parsed.rows[0].listener_avg, 111.5);
  assert.equal(parsed.rows[0].listener_min, 98);
  assert.equal(parsed.rows[0].listener_max, 150);
  assert.equal(parsed.rows[0].distinct_tracks, 4);
  assert.equal(parsed.rows[0].comment_count, 321);
  assert.equal(parsed.rows[0].estimated_streams, 446);
});

test('verified listening party metadata repairs track counts and supplies content and official source', () => {
  const parsed = parseBroadcastSummaryRows([
    {
      event_name: '2024.07.23『YUI KOBAYASHI GRADUATION CONCERT』Stationhead Listening Party',
      started_at: 1,
      ended_at: 2,
      sample_count: 1,
      listener_avg: 1019.1,
      listener_max: 1080,
      likes_max: null,
      distinct_tracks: 2,
      host_handle: 'sakurazaka46jp',
      has_data: 1,
    },
    {
      event_name: '2025.10.29 13th Single『Unhappy birthday構文』リリース記念Stationheadリスニングパーティー',
      started_at: 3,
      ended_at: 4,
      sample_count: 1,
      listener_avg: 788.8,
      listener_max: 901,
      likes_max: null,
      distinct_tracks: 7,
      host_handle: 'sakurazaka46jp',
      has_data: 1,
    },
    {
      event_name: '2025.12.30『THANK YOU BUDDIES!! THANK YOU 2025!! 櫻坂46 YEAR-END LISTENING PARTY』',
      started_at: 5,
      ended_at: 6,
      sample_count: 1,
      listener_avg: 833.4,
      listener_max: 983,
      likes_max: null,
      distinct_tracks: 22,
      host_handle: 'sakurazaka46jp',
      has_data: 1,
    },
  ]);

  assert.equal(parsed.rows[0].distinct_tracks, 20);
  assert.equal(parsed.rows[0].estimated_streams, 20382);
  assert.equal(parsed.rows[0].broadcast_content, '小林由依卒業コンサート DAY2セットリスト');
  assert.equal(parsed.rows[0].source_url, 'https://sakurazaka46.com/s/s46/news/detail/M01328');
  assert.equal(parsed.rows[1].distinct_tracks, 5);
  assert.equal(parsed.rows[1].broadcast_content, '13th Single「Unhappy birthday構文」Special Edition（トラブルで実再生5曲）');
  assert.equal(parsed.rows[2].distinct_tracks, 29);
  assert.equal(parsed.rows[2].broadcast_content, '2025年リリース22曲＋Interlude7曲（全29曲・楽曲尺93分19秒）');
});

test('an empty UTC range reports whether the compact summary is provisioned', () => {
  const db = new DatabaseSync(':memory:');
  createSummaryTable(db);
  const parsed = parseBroadcastSummaryRows(db.prepare(BROADCAST_SUMMARY_SQL).all(0, 100, 0, 100));
  assert.deepEqual(parsed.rows, []);
  assert.equal(parsed.setupRequired, true);
});
