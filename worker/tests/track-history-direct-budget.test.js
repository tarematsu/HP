import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { directRevisionTrackHistorySql } from '../src/track-history-direct-revision-sql.js';

const DAY = 86400000;
const start = Date.UTC(2026, 9, 8);
const end = start + DAY;
function database() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE sh_minute_facts(id INTEGER PRIMARY KEY,minute_at INTEGER,observed_at INTEGER,
      is_broadcasting INTEGER,is_paused INTEGER,broadcast_session_id INTEGER);
    CREATE INDEX idx_sh_minute_facts_time ON sh_minute_facts(minute_at);
    CREATE INDEX idx_sh_minute_facts_observed_id ON sh_minute_facts(observed_at,id);
    CREATE TABLE sh_minute_fact_context_v2(fact_id INTEGER PRIMARY KEY,station_id_override INTEGER,
      queue_revision_id INTEGER,queue_available INTEGER);
    CREATE TABLE sh_broadcast_sessions(id INTEGER PRIMARY KEY,station_id INTEGER);
    CREATE TABLE sh_queue_revisions(id INTEGER PRIMARY KEY,effective_at INTEGER,station_id INTEGER,
      queue_id INTEGER,queue_start_time INTEGER);
    CREATE TABLE sh_queue_revision_items(revision_id INTEGER,position INTEGER,track_id INTEGER,
      queue_track_id INTEGER,stationhead_track_id INTEGER,spotify_id TEXT,deezer_id TEXT,isrc TEXT,
      duration_ms INTEGER,bite_count INTEGER,PRIMARY KEY(revision_id,position));
    CREATE TABLE sh_track_counter_current(occurrence_key TEXT PRIMARY KEY,count_value INTEGER);
    CREATE TABLE sh_track_metadata(spotify_id TEXT PRIMARY KEY,title TEXT,artist TEXT,
      display_title TEXT,spotify_url TEXT);
    CREATE TABLE sh_track_history_queue_starts(station_id INTEGER,start_time INTEGER,
      latest_revision_id INTEGER,PRIMARY KEY(station_id,start_time));
    CREATE INDEX idx_sh_track_history_queue_starts_time ON sh_track_history_queue_starts(start_time,station_id);
    CREATE VIEW sh_channel_snapshots AS SELECT f.id,f.minute_at AS observed_at,
      CASE WHEN c.fact_id IS NOT NULL THEN COALESCE(c.station_id_override,s.station_id) END AS station_id,
      f.is_broadcasting AS is_launched,f.is_broadcasting
      FROM sh_minute_facts f LEFT JOIN sh_minute_fact_context_v2 c ON c.fact_id=f.id
      LEFT JOIN sh_broadcast_sessions s ON s.id=f.broadcast_session_id;
    CREATE VIEW sh_queue_snapshots AS SELECT f.id,f.observed_at,
      COALESCE(c.station_id_override,s.station_id,r.station_id) AS station_id,
      r.queue_start_time AS start_time,COALESCE(f.is_paused,0) AS is_paused
      FROM sh_minute_facts f JOIN sh_minute_fact_context_v2 c ON c.fact_id=f.id
      JOIN sh_queue_revisions r ON r.id=c.queue_revision_id
      LEFT JOIN sh_broadcast_sessions s ON s.id=f.broadcast_session_id
      WHERE c.queue_available=1 AND r.queue_start_time IS NOT NULL;
    INSERT INTO sh_broadcast_sessions VALUES(1,318);
  `);
  const revision = db.prepare('INSERT INTO sh_queue_revisions VALUES(?,?,?,?,?)');
  const queue = db.prepare('INSERT INTO sh_track_history_queue_starts VALUES(?,?,?)');
  const item = db.prepare('INSERT INTO sh_queue_revision_items VALUES(?,?,?,?,?,?,?,?,?,?)');
  // Include a queue crossing midnight and a later replacement, preserving pause
  // and continuation behavior as well as end-of-day coverage evidence.
  for (const [id,time] of [[1,start-120000],[2,start+900000]]) {
    revision.run(id,time,318,1,time);
    queue.run(318,time,id);
    for(let position=0;position<8;position++) {
      item.run(id,position,position+1,position+1,position+1,`track-${position}`,null,null,180000,10);
    }
  }
  const fact=db.prepare('INSERT INTO sh_minute_facts VALUES(?,?,?,?,?,1)');
  const context=db.prepare('INSERT INTO sh_minute_fact_context_v2 VALUES(?,NULL,?,1)');
  for(let n=-2;n<=1440;n++) {
    const time=start+n*60000;
    fact.run(n+3,time,time,1,n>=3&&n<5?1:0);
    context.run(n+3,n<15?1:2);
  }
  return db;
}
const bindings=[end,start-300000,end,start-300000,end,start-300000,end,end,300000,start,end,start,end,40001];
function compatibilitySql(sql) {
  const from=sql.indexOf('), history_channel_snapshots AS MATERIALIZED (');
  const to=sql.indexOf('), queue_starts AS MATERIALIZED (');
  return (sql.slice(0,from)+sql.slice(to))
    .replaceAll('history_channel_snapshots','sh_channel_snapshots')
    .replaceAll('history_queue_snapshots','sh_queue_snapshots');
}

test('compact evidence preserves reconstructed plays, pause states and boundary coverage',()=>{
  const db=database();
  const sql=directRevisionTrackHistorySql();
  for (const to of [end, start+150000]) {
    const values=[...bindings];
    for(const index of [0,2,4,6,7,10,12]) values[index]=to;
    const expected=db.prepare(compatibilitySql(sql)).all(...values);
    assert.ok(expected.length>0);
    assert.deepEqual(db.prepare(sql).all(...values),expected);
  }
  db.close();
});

test('both evidence timelines seek fact indexes before sparse context joins',()=>{
  const db=database();
  // Out-of-window history must not be read by either materialized evidence CTE.
  db.exec(`WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<20000)
    INSERT INTO sh_minute_facts SELECT x+10000,${start-90*DAY}+x*60000,${start-90*DAY}+x*60000,1,0,1 FROM n`);
  const sql=directRevisionTrackHistorySql();
  const plan=db.prepare('EXPLAIN QUERY PLAN '+sql).all(...bindings).map(row=>row.detail).join('\n');
  assert.match(plan,/SEARCH f USING INDEX idx_sh_minute_facts_time \(minute_at>\? AND minute_at<\?\)/);
  assert.match(plan,/SEARCH f USING INDEX idx_sh_minute_facts_observed_id \(observed_at>\? AND observed_at<\?\)/);
  assert.doesNotMatch(plan,/SCAN f\b|SCAN context\b/);
  const original=db.prepare(compatibilitySql(sql)).all(...bindings);
  assert.deepEqual(db.prepare(sql).all(...bindings),original);
  db.close();
});
