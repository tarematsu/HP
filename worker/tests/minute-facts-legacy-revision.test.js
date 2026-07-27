import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import {
  PLAYBACK_STATE_HEARTBEAT_MS,
  updatePlaybackState,
  writeCurrentBite,
} from '../src/minute-facts-legacy-revision.js';

function createDatabase() {
  const sqlite = new DatabaseSync(':memory:');
  const preparedSql = [];
  sqlite.exec(`
    CREATE TABLE sh_playback_current (
      channel_id INTEGER PRIMARY KEY,
      session_id INTEGER,
      revision_id INTEGER,
      queue_start_time INTEGER,
      is_paused INTEGER,
      paused_total_ms INTEGER,
      pause_started_at INTEGER,
      last_observed_at INTEGER,
      current_position INTEGER
    );
    CREATE TABLE sh_queue_revision_items (
      revision_id INTEGER NOT NULL,
      position INTEGER NOT NULL,
      track_id INTEGER,
      duration_ms INTEGER,
      playback_offset_ms INTEGER,
      schedule_valid INTEGER
    );
    CREATE TABLE sh_queue_state_events (
      revision_id INTEGER,
      observed_at INTEGER,
      is_paused INTEGER,
      source TEXT
    );
    CREATE TABLE sh_track_counter_changes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      observed_at INTEGER,
      occurrence_key TEXT,
      channel_id INTEGER,
      station_id INTEGER,
      queue_id INTEGER,
      queue_start_time INTEGER,
      queue_position INTEGER,
      queue_track_id INTEGER,
      stationhead_track_id INTEGER,
      spotify_id TEXT,
      apple_music_id TEXT,
      isrc TEXT,
      queue_revision_id INTEGER,
      track_id INTEGER,
      track_key TEXT,
      count_value INTEGER,
      source TEXT,
      source_record_id TEXT UNIQUE
    );
    CREATE TABLE sh_track_counter_current (
      occurrence_key TEXT PRIMARY KEY,
      count_value INTEGER NOT NULL,
      observed_at INTEGER NOT NULL,
      change_id INTEGER NOT NULL
    );
    CREATE TRIGGER trg_sh_track_counter_current
    AFTER INSERT ON sh_track_counter_changes
    BEGIN
      INSERT INTO sh_track_counter_current(
        occurrence_key,count_value,observed_at,change_id
      ) VALUES(
        NEW.occurrence_key,NEW.count_value,NEW.observed_at,NEW.id
      ) ON CONFLICT(occurrence_key) DO UPDATE SET
        count_value=excluded.count_value,
        observed_at=excluded.observed_at,
        change_id=excluded.change_id
      WHERE excluded.observed_at>=sh_track_counter_current.observed_at;
    END;
  `);
  return {
    sqlite,
    preparedSql,
    prepare(sql) {
      preparedSql.push(sql);
      const statement = sqlite.prepare(sql);
      return {
        bind(...params) {
          return {
            async first() {
              return statement.get(...params) || null;
            },
            async all() {
              return { results: statement.all(...params) };
            },
            async run() {
              const result = statement.run(...params);
              return { meta: { changes: Number(result.changes || 0) } };
            },
          };
        },
      };
    },
  };
}

test('revision changes within one queue instance preserve pause accumulation', async () => {
  const db = createDatabase();
  const queueStartTime = 1_700_000_000_000;
  db.sqlite.exec(`
    INSERT INTO sh_queue_revision_items VALUES (1,0,101,180000,0,1);
    INSERT INTO sh_queue_revision_items VALUES (2,0,102,180000,0,1);
  `);

  await updatePlaybackState(db, {
    channelId: 10,
    sessionId: 20,
    revisionId: 1,
    queueStartTime,
    observedAt: queueStartTime + 60_000,
    isPaused: true,
  });
  await updatePlaybackState(db, {
    channelId: 10,
    sessionId: 20,
    revisionId: 2,
    queueStartTime,
    observedAt: queueStartTime + 120_000,
    isPaused: true,
  });
  await updatePlaybackState(db, {
    channelId: 10,
    sessionId: 20,
    revisionId: 2,
    queueStartTime,
    observedAt: queueStartTime + 180_000,
    isPaused: false,
  });

  const state = db.sqlite.prepare(`SELECT paused_total_ms,pause_started_at,is_paused
    FROM sh_playback_current WHERE channel_id=10`).get();
  assert.equal(state.paused_total_ms, 120_000);
  assert.equal(state.pause_started_at, null);
  assert.equal(state.is_paused, 0);
});

test('unchanged playback state writes only on the bounded heartbeat', async () => {
  const db = createDatabase();
  const queueStartTime = 1_700_000_000_000;
  const firstObservedAt = queueStartTime + 60_000;
  db.sqlite.exec('INSERT INTO sh_queue_revision_items VALUES (1,0,101,7200000,0,1)');

  await updatePlaybackState(db, {
    channelId: 10,
    sessionId: 20,
    revisionId: 1,
    queueStartTime,
    observedAt: firstObservedAt,
    isPaused: false,
  });
  await updatePlaybackState(db, {
    channelId: 10,
    sessionId: 20,
    revisionId: 1,
    queueStartTime,
    observedAt: firstObservedAt + 60_000,
    isPaused: false,
  });

  let state = db.sqlite.prepare(`SELECT last_observed_at,current_position
    FROM sh_playback_current WHERE channel_id=10`).get();
  assert.equal(state.last_observed_at, firstObservedAt);
  assert.equal(state.current_position, 0);

  await updatePlaybackState(db, {
    channelId: 10,
    sessionId: 20,
    revisionId: 1,
    queueStartTime,
    observedAt: firstObservedAt + PLAYBACK_STATE_HEARTBEAT_MS,
    isPaused: false,
  });

  state = db.sqlite.prepare(`SELECT last_observed_at,current_position
    FROM sh_playback_current WHERE channel_id=10`).get();
  assert.equal(state.last_observed_at, firstObservedAt + PLAYBACK_STATE_HEARTBEAT_MS);
  assert.equal(state.current_position, 0);
});

test('current bite uses one conditional insert and records only count changes', async () => {
  const db = createDatabase();
  const queue = {
    queue_id: 30,
    start_time: 1_700_000_000,
    tracks: [{
      position: 0,
      queue_track_id: 40,
      stationhead_track_id: 50,
      spotify_id: 'spotify-1',
      isrc: 'JP-A',
      bite_count: 5,
    }],
  };
  db.preparedSql.length = 0;

  await writeCurrentBite(db, {
    channelId: 10,
    stationId: 20,
    revisionId: 60,
    position: 0,
    observedAt: 1_700_000_060_000,
    queue,
    trackId: 70,
  });
  await writeCurrentBite(db, {
    channelId: 10,
    stationId: 20,
    revisionId: 60,
    position: 0,
    observedAt: 1_700_000_120_000,
    queue,
    trackId: 70,
  });
  queue.tracks[0].bite_count = 6;
  await writeCurrentBite(db, {
    channelId: 10,
    stationId: 20,
    revisionId: 60,
    position: 0,
    observedAt: 1_700_000_180_000,
    queue,
    trackId: 70,
  });

  const rows = db.sqlite.prepare(`SELECT count_value FROM sh_track_counter_changes
    ORDER BY observed_at,id`).all();
  assert.deepEqual(rows.map((row) => Number(row.count_value)), [5, 6]);
  const current = db.sqlite.prepare(`SELECT count_value FROM sh_track_counter_current
    WHERE occurrence_key='revision:60:0'`).get();
  assert.equal(Number(current.count_value), 6);
  assert.equal(db.preparedSql.length, 3);
  assert.ok(db.preparedSql.every((sql) => sql.includes('INSERT OR IGNORE INTO sh_track_counter_changes')));
  assert.ok(db.preparedSql.every((sql) => sql.includes('WHERE ? IS NOT')));
  assert.ok(db.preparedSql.every((sql) => sql.includes('FROM sh_track_counter_current')));
});
