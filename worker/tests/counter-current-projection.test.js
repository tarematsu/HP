import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

const migration = readFileSync(
  new URL('../../database/facts-migrations/048_use_counter_current_projection.sql', import.meta.url),
  'utf8',
);
const legacyRevision = readFileSync(
  new URL('../src/minute-facts-legacy-revision.js', import.meta.url),
  'utf8',
);

function database() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE sh_track_counter_changes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      observed_at INTEGER NOT NULL,
      occurrence_key TEXT NOT NULL,
      count_value INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX idx_sh_counter_changes_event
      ON sh_track_counter_changes(occurrence_key,observed_at,count_value);
    CREATE INDEX idx_sh_counter_changes_occurrence_time
      ON sh_track_counter_changes(occurrence_key,observed_at DESC,id DESC);
    CREATE INDEX idx_sh_counter_changes_time
      ON sh_track_counter_changes(observed_at DESC,id DESC);

    CREATE TABLE sh_track_counter_current (
      occurrence_key TEXT PRIMARY KEY,
      count_value INTEGER NOT NULL,
      observed_at INTEGER NOT NULL,
      change_id INTEGER NOT NULL
    );
    CREATE TABLE sh_queue_revisions (
      id INTEGER PRIMARY KEY,
      effective_at INTEGER NOT NULL,
      channel_id INTEGER NOT NULL,
      station_id INTEGER,
      queue_id INTEGER,
      queue_start_time INTEGER,
      item_count INTEGER NOT NULL,
      status TEXT NOT NULL
    );
    CREATE TABLE sh_queue_revision_items (
      revision_id INTEGER NOT NULL,
      position INTEGER NOT NULL,
      queue_track_id INTEGER,
      stationhead_track_id INTEGER,
      spotify_id TEXT,
      deezer_id TEXT,
      isrc TEXT,
      duration_ms INTEGER,
      bite_count INTEGER,
      track_id INTEGER,
      PRIMARY KEY(revision_id,position)
    );
    CREATE TABLE sh_minute_facts (
      id INTEGER PRIMARY KEY,
      broadcast_session_id INTEGER,
      queue_position_patch INTEGER
    );
    CREATE TABLE sh_minute_fact_context_v2 (
      fact_id INTEGER PRIMARY KEY,
      station_id_override INTEGER,
      host_id_override INTEGER,
      broadcast_start_time_override INTEGER,
      queue_revision_id INTEGER,
      queue_available INTEGER NOT NULL,
      queue_position INTEGER
    );
    CREATE TABLE sh_broadcast_sessions (
      id INTEGER PRIMARY KEY,
      station_id INTEGER,
      host_id INTEGER,
      broadcast_start_time INTEGER
    );

    CREATE VIEW sh_queue_items AS SELECT 1 AS id;
    CREATE VIEW sh_minute_fact_context AS SELECT 1 AS fact_id;

    INSERT INTO sh_queue_revisions VALUES
      (10,1000,7,8,9,500,1,'complete'),
      (11,1100,7,8,9,500,1,'complete');
    INSERT INTO sh_queue_revision_items VALUES
      (10,0,101,201,'old','old','OLD',180000,3,301),
      (11,0,102,202,'new','new','NEW',180000,4,302);
    INSERT INTO sh_track_counter_changes(observed_at,occurrence_key,count_value) VALUES
      (1000,'revision:11:0',5),
      (2000,'revision:11:0',6);
    INSERT INTO sh_track_counter_current VALUES('revision:11:0',6,2000,2);
    INSERT INTO sh_minute_facts VALUES(20,NULL,0);
    INSERT INTO sh_minute_fact_context_v2 VALUES(20,8,9,500,11,1,0);
  `);
  db.exec(migration);
  return db;
}

test('counter latest reads use the current projection and retain only required log indexes', () => {
  const db = database();

  const indexes = db.prepare("SELECT name FROM pragma_index_list('sh_track_counter_changes')")
    .all()
    .map(({ name }) => String(name));
  assert.equal(indexes.includes('idx_sh_counter_changes_occurrence_time'), false);
  assert.equal(indexes.includes('idx_sh_counter_changes_event'), true);
  assert.equal(indexes.includes('idx_sh_counter_changes_time'), true);

  const currentPlan = db.prepare(`EXPLAIN QUERY PLAN
    SELECT count_value FROM sh_track_counter_current WHERE occurrence_key=?`)
    .all('revision:11:0')
    .map(({ detail }) => String(detail));
  assert.ok(
    currentPlan.some((detail) => detail.includes('SEARCH sh_track_counter_current USING INDEX')),
    `expected occurrence-key point lookup: ${currentPlan.join(' | ')}`,
  );
  assert.ok(
    currentPlan.every((detail) => !detail.includes('SCAN sh_track_counter_changes')),
    `current lookup unexpectedly scans history: ${currentPlan.join(' | ')}`,
  );

  const queueItem = db.prepare('SELECT id,bite_count FROM sh_queue_items').get();
  assert.deepEqual({ ...queueItem }, { id: 11_000_000, bite_count: 6 });

  const context = db.prepare('SELECT fact_id,track_bite_count FROM sh_minute_fact_context').get();
  assert.deepEqual({ ...context }, { fact_id: 20, track_bite_count: 6 });
});

test('runtime counter-change guard reads the current projection instead of append-only history', () => {
  assert.match(
    legacyRevision,
    /SELECT count_value FROM sh_track_counter_current WHERE occurrence_key=\?/,
  );
  assert.doesNotMatch(
    legacyRevision,
    /SELECT count_value FROM sh_track_counter_changes\s+WHERE occurrence_key=\?\s+ORDER BY/,
  );
  assert.match(migration, /DROP INDEX IF EXISTS idx_sh_counter_changes_occurrence_time/);
  assert.match(migration, /FROM sh_track_counter_current cc/);
});
