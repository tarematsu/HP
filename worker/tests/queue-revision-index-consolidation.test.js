import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

const migration = readFileSync(
  new URL('../../database/facts-migrations/048_use_counter_current_projection.sql', import.meta.url),
  'utf8',
);

const retiredIndexes = [
  'idx_sh_queue_revisions_channel_effective',
  'idx_sh_queue_revisions_coverage',
  'idx_sh_queue_revisions_source_job',
  'idx_sh_queue_revisions_materialization',
];

function details(db, sql, ...bindings) {
  return db.prepare(`EXPLAIN QUERY PLAN ${sql}`)
    .all(...bindings)
    .map(({ detail }) => String(detail));
}

function database() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE sh_track_counter_current(
      occurrence_key TEXT PRIMARY KEY,count_value INTEGER NOT NULL
    );
    CREATE TABLE sh_track_counter_changes(
      id INTEGER PRIMARY KEY,observed_at INTEGER,occurrence_key TEXT,count_value INTEGER
    );
    CREATE INDEX idx_sh_counter_changes_occurrence_time
      ON sh_track_counter_changes(occurrence_key,observed_at DESC,id DESC);
    CREATE TABLE sh_queue_revisions(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER,channel_id INTEGER NOT NULL,station_id INTEGER,queue_id INTEGER,
      queue_start_time INTEGER,effective_at INTEGER NOT NULL,received_at INTEGER NOT NULL,
      structural_hash TEXT NOT NULL,item_count INTEGER NOT NULL,
      materialized_item_count INTEGER,coverage_complete INTEGER NOT NULL DEFAULT 1,
      source_job_id INTEGER,source_visible_count INTEGER,last_materialized_at INTEGER,
      status TEXT NOT NULL,source TEXT NOT NULL,source_priority INTEGER NOT NULL,
      UNIQUE(channel_id,effective_at,structural_hash)
    );
    CREATE INDEX idx_sh_queue_revisions_channel_effective
      ON sh_queue_revisions(channel_id,effective_at DESC);
    CREATE INDEX idx_sh_queue_revisions_session
      ON sh_queue_revisions(session_id,effective_at);
    CREATE INDEX idx_sh_queue_revisions_coverage
      ON sh_queue_revisions(channel_id,coverage_complete,effective_at DESC);
    CREATE INDEX idx_sh_queue_revisions_source_job
      ON sh_queue_revisions(source_job_id) WHERE source_job_id IS NOT NULL;
    CREATE INDEX idx_sh_queue_revisions_materialization
      ON sh_queue_revisions(coverage_complete,last_materialized_at,effective_at);
    CREATE INDEX idx_sh_queue_revisions_recent_complete
      ON sh_queue_revisions(effective_at DESC,id DESC)
      WHERE status='complete' AND source='live_collector';
    CREATE INDEX idx_sh_queue_revisions_reuse
      ON sh_queue_revisions(
        channel_id,structural_hash,session_id,queue_start_time,effective_at DESC,id DESC
      ) WHERE status IN ('complete','pending');
    CREATE INDEX idx_sh_queue_revisions_track_history_latest
      ON sh_queue_revisions(
        queue_start_time,channel_id,COALESCE(station_id,-1),effective_at DESC,id DESC
      ) WHERE status='complete' AND queue_start_time IS NOT NULL;
    CREATE INDEX idx_sh_queue_revisions_sparse_recovery
      ON sh_queue_revisions(COALESCE(last_materialized_at,effective_at),effective_at,id)
      WHERE source_job_id IS NOT NULL
        AND COALESCE(coverage_complete,0)=0
        AND COALESCE(source_visible_count,0)>COALESCE(materialized_item_count,0);
    CREATE INDEX idx_sh_queue_revisions_payload_blocking
      ON sh_queue_revisions(source_job_id,id)
      WHERE source_job_id IS NOT NULL
        AND (status<>'complete'
          OR COALESCE(materialized_item_count,0)<COALESCE(source_visible_count,item_count,0));
    CREATE TABLE sh_queue_revision_items(
      revision_id INTEGER NOT NULL,position INTEGER NOT NULL,track_id INTEGER,
      queue_track_id INTEGER,stationhead_track_id INTEGER,spotify_id TEXT,deezer_id TEXT,
      isrc TEXT,duration_ms INTEGER,bite_count INTEGER,PRIMARY KEY(revision_id,position)
    );
    CREATE TABLE sh_minute_facts(
      id INTEGER PRIMARY KEY,broadcast_session_id INTEGER,queue_position_patch INTEGER
    );
    CREATE TABLE sh_minute_fact_context_v2(
      fact_id INTEGER PRIMARY KEY,station_id_override INTEGER,host_id_override INTEGER,
      broadcast_start_time_override INTEGER,queue_revision_id INTEGER,
      queue_available INTEGER NOT NULL,queue_position INTEGER
    );
    CREATE TABLE sh_broadcast_sessions(
      id INTEGER PRIMARY KEY,station_id INTEGER,host_id INTEGER,broadcast_start_time INTEGER
    );
    CREATE VIEW sh_queue_items AS SELECT 1 AS id;
    CREATE VIEW sh_minute_fact_context AS SELECT 1 AS fact_id;

    INSERT INTO sh_queue_revisions(
      session_id,channel_id,station_id,queue_id,queue_start_time,effective_at,received_at,
      structural_hash,item_count,materialized_item_count,coverage_complete,source_job_id,
      source_visible_count,last_materialized_at,status,source,source_priority
    ) VALUES
      (1,7,8,9,1000,1100,1100,'complete-hash',1,1,1,10,1,1100,'complete','live_collector',100),
      (1,7,8,9,1000,1200,1200,'pending-hash',3,0,0,11,3,NULL,'pending','live_collector',100);
    INSERT INTO sh_queue_revision_items VALUES(1,0,30,10,20,'sp','dz','JPTEST',180000,4);
    INSERT INTO sh_track_counter_current VALUES('revision:1:0',5);
    INSERT INTO sh_minute_facts VALUES(20,NULL,0);
    INSERT INTO sh_minute_fact_context_v2 VALUES(20,8,9,1000,1,1,0);
  `);
  db.exec(migration);
  return db;
}

test('queue revision migration retires only superseded write-amplifying indexes', () => {
  const db = database();
  const names = db.prepare("SELECT name FROM pragma_index_list('sh_queue_revisions')")
    .all()
    .map(({ name }) => String(name));

  for (const name of retiredIndexes) assert.equal(names.includes(name), false, name);
  for (const name of [
    'sqlite_autoindex_sh_queue_revisions_1',
    'idx_sh_queue_revisions_session',
    'idx_sh_queue_revisions_recent_complete',
    'idx_sh_queue_revisions_reuse',
    'idx_sh_queue_revisions_track_history_latest',
    'idx_sh_queue_revisions_sparse_recovery',
    'idx_sh_queue_revisions_payload_blocking',
  ]) assert.equal(names.includes(name), true, name);
});

test('queue revision hotpaths retain bounded index seeks after consolidation', () => {
  const db = database();
  const stored = details(db, `SELECT id FROM sh_queue_revisions
    WHERE channel_id=? AND effective_at=? AND structural_hash=? LIMIT 1`, 7, 1100, 'complete-hash');
  assert.ok(stored.some((detail) => detail.includes('sqlite_autoindex_sh_queue_revisions_1')));

  const reuse = details(db, `SELECT id,status,effective_at,item_count FROM sh_queue_revisions
    WHERE channel_id=? AND structural_hash=? AND session_id IS ? AND queue_start_time IS ?
      AND status IN ('complete','pending')
    ORDER BY CASE status WHEN 'complete' THEN 0 ELSE 1 END,effective_at DESC,id DESC
    LIMIT 1`, 7, 'pending-hash', 1, 1000);
  assert.ok(reuse.some((detail) => detail.includes('idx_sh_queue_revisions_reuse')));

  const sparse = details(db, `SELECT id FROM sh_queue_revisions
    INDEXED BY idx_sh_queue_revisions_sparse_recovery
    WHERE source_job_id IS NOT NULL
      AND COALESCE(coverage_complete,0)=0
      AND COALESCE(source_visible_count,0)>COALESCE(materialized_item_count,0)
      AND effective_at<=?
      AND COALESCE(last_materialized_at,effective_at)<=?
    ORDER BY COALESCE(last_materialized_at,effective_at),id LIMIT 1`, 2000, 2000);
  assert.ok(sparse.some((detail) => detail.includes('idx_sh_queue_revisions_sparse_recovery')));

  const blocking = details(db, `SELECT 1 FROM sh_queue_revisions
    WHERE source_job_id=? AND (status<>'complete'
      OR COALESCE(materialized_item_count,0)<COALESCE(source_visible_count,item_count,0))
    LIMIT 1`, 11);
  assert.ok(blocking.some((detail) => detail.includes('idx_sh_queue_revisions_payload_blocking')));

  const history = details(db, `SELECT id FROM sh_queue_revisions
    WHERE status='complete' AND queue_start_time=? AND channel_id=?
      AND COALESCE(station_id,-1)=?
    ORDER BY effective_at DESC,id DESC LIMIT 1`, 1000, 7, 8);
  assert.ok(history.some((detail) => detail.includes('idx_sh_queue_revisions_track_history_latest')));

  const session = details(db, `SELECT id FROM sh_queue_revisions
    WHERE session_id=? ORDER BY effective_at DESC LIMIT 1`, 1);
  assert.ok(session.some((detail) => detail.includes('idx_sh_queue_revisions_session')));
});

test('queue revision consolidation remains metadata-only', () => {
  for (const name of retiredIndexes) {
    assert.match(migration, new RegExp(`DROP INDEX IF EXISTS ${name}`));
  }
  assert.doesNotMatch(migration, /\bANALYZE\b|\bPRAGMA\s+optimize\b/i);
  assert.doesNotMatch(migration, /\bINSERT\b|\bUPDATE\b|\bDELETE\b/i);
});
