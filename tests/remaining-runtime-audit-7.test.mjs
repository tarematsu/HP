import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { loadQueueComparisonState } from '../site/functions/lib/ingest.js';
import {
  BROADCAST_SUMMARY_SQL,
  parseBroadcastSummaryRows,
} from '../site/functions/api/history.js';

test('queue items and latest likes share one D1 read batch', async () => {
  let batchCalls = 0;
  let directAllCalls = 0;
  const prepared = [];
  const db = {
    prepare(sql) {
      const statement = {
        sql,
        values: [],
        bind(...values) { this.values = values; return this; },
        async all() { directAllCalls += 1; return { results: [] }; },
      };
      prepared.push(statement);
      return statement;
    },
    async batch(statements) {
      batchCalls += 1;
      assert.equal(statements.length, 2);
      return statements.map((statement) => {
        if (statement.sql.includes('FROM sh_queue_items')) {
          return { results: [{ position: 0, observed_at: 1000, spotify_id: 'track-a' }] };
        }
        if (statement.sql.includes('FROM sh_track_like_observations')) {
          return { results: [{ track_key: 'queue-1', observed_at: 1000, like_count: 4 }] };
        }
        throw new Error('unexpected statement');
      });
    },
  };

  const state = await loadQueueComparisonState(db, 7, 500, [0, 1], ['queue-1']);
  assert.equal(batchCalls, 1);
  assert.equal(directAllCalls, 0);
  assert.equal(prepared.length, 2);
  assert.equal(state.statementCount, 2);
  assert.equal(state.existingRows[0].spotify_id, 'track-a');
  assert.equal(state.latestRows[0].like_count, 4);
});

test('Stationhead comment velocity runtime is retired', () => {
  const ingest = readFileSync(new URL('../site/functions/lib/ingest.js', import.meta.url), 'utf8');
  assert.doesNotMatch(ingest, /saveCommentCounts|COMMENT_VELOCITY_UPDATE_SQL/);
});

test('broadcast summary reports empty range and setup state in one query', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE sh_official_broadcast_summary (
    host_handle TEXT NOT NULL,event_name TEXT NOT NULL,started_at INTEGER,
    ended_at INTEGER,started_jst TEXT,ended_jst TEXT,sample_count INTEGER,
    listener_avg REAL,listener_max INTEGER,likes_max INTEGER,distinct_tracks INTEGER,
    PRIMARY KEY(host_handle,event_name)
  )`);

  const empty = parseBroadcastSummaryRows(db.prepare(BROADCAST_SUMMARY_SQL).all(0, 100, 0, 100));
  assert.deepEqual(empty.rows, []);
  assert.equal(empty.setupRequired, true);

  db.prepare(`INSERT INTO sh_official_broadcast_summary
    (host_handle,event_name,started_at,ended_at,started_jst,ended_jst,sample_count,listener_avg,listener_max,likes_max,distinct_tracks)
    VALUES ('sakurazaka46jp','Event A',1000,2000,'2026-07-01 00:00:01','2026-07-01 00:00:02',2,25,25,3,1)`).run();

  const outside = parseBroadcastSummaryRows(db.prepare(BROADCAST_SUMMARY_SQL).all(0, 100, 0, 100));
  assert.deepEqual(outside.rows, []);
  assert.equal(outside.setupRequired, false);

  const inside = parseBroadcastSummaryRows(db.prepare(BROADCAST_SUMMARY_SQL).all(0, 2000, 0, 2000));
  assert.equal(inside.setupRequired, false);
  assert.equal(inside.rows.length, 1);
  assert.equal(inside.rows[0].event_name, 'Event A');
  assert.equal(inside.rows[0].listener_avg, 25);
  assert.equal(Object.hasOwn(inside.rows[0], 'has_data'), false);
});

test('history display layer uses current canonical modules only', () => {
  const source = readFileSync(
    new URL('../site/public/history/history-lite.js', import.meta.url),
    'utf8',
  );
  const entry = readFileSync(
    new URL('../site/public/history/history-main.js', import.meta.url),
    'utf8',
  );
  assert.match(source, /CACHE_PREFIX = 'sh\.history\.v3:'/);
  assert.match(source, /broadcasts: \{ title: '公式ストリーム比較', table: '公式ストリーム一覧'/);
  assert.doesNotMatch(source, /tracks: \{|再生曲一覧|history-copy-fixes|history-track-likes/);
  assert.match(entry, /history-broadcasts\.js\?v=20260927\.1/);
  assert.match(entry, /history-period-chart\.js\?v=20260923\.\d+/);
});
