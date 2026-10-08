import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

import { BROADCAST_SUMMARY_SQL } from '../site/functions/api/history.js';

import { planLikeObservations, latestLikesSql } from '../site/functions/lib/ingest.js';
import { listenerAggregateDelta } from '../site/functions/lib/host-ingest.js';

test('broadcast summary returns minimum listener without a second series query', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE sh_official_broadcast_summary(
    host_handle TEXT NOT NULL,event_name TEXT NOT NULL,started_at INTEGER,
    ended_at INTEGER,started_jst TEXT,ended_jst TEXT,sample_count INTEGER,
    listener_avg REAL,listener_max INTEGER,likes_max INTEGER,distinct_tracks INTEGER,
    PRIMARY KEY(host_handle,event_name)
  )`);
  db.prepare(`INSERT INTO sh_official_broadcast_summary VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
    'sakurazaka46jp', 'event', 1000, 3000, '2026-01-01 00:00',
    '2026-01-01 00:02', 3, 20.7, 30, 3, 2,
  );

  const rows = db.prepare(BROADCAST_SUMMARY_SQL).all(0, 4000, 0, 4000);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].listener_max, 30);
  assert.equal(rows[0].distinct_tracks, 2);
});

test('queue like observations are planned from one batched latest-row lookup', () => {
  const now = 10_000_000;
  const tracks = [
    { queue_track_id: 1, bite_count: 5, position: 0 },
    { queue_track_id: 2, bite_count: 7, position: 1 },
    { queue_track_id: 2, bite_count: 7, position: 1 },
  ];
  const planned = planLikeObservations(tracks, [
    { track_key: '1', like_count: 5, observed_at: now - 1000 },
    { track_key: '2', like_count: 6, observed_at: now - 1000 },
  ], now);
  assert.deepEqual(planned.map((item) => item.trackKey), ['2']);
  assert.match(latestLikesSql(2), /IN \(\?,\?\)/);
});

test('listener aggregates can be updated from the replaced minute delta', () => {
  assert.deepEqual(listenerAggregateDelta(null, 10), { sum: 10, count: 1 });
  assert.deepEqual(listenerAggregateDelta(10, 12), { sum: 2, count: 0 });
  assert.deepEqual(listenerAggregateDelta(10, null), { sum: -10, count: -1 });
});
