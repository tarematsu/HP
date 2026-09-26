import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

const descriptor = JSON.parse(readFileSync(
  new URL('../database/facts-db.json', import.meta.url),
  'utf8',
));
const migration = readFileSync(
  new URL('../database/facts-migrations/056_stream_minute_delta_read_model.sql', import.meta.url),
  'utf8',
);
const dashboard = readFileSync(
  new URL('../site/functions/lib/dashboard-chart-support.js', import.meta.url),
  'utf8',
);

test('stream minute delta read model is the current MINUTE_DB schema tip', () => {
  const path = 'database/facts-migrations/056_stream_minute_delta_read_model.sql';
  assert.equal(descriptor.schema, path);
  assert.equal(descriptor.migrations.at(-1), path);
  assert.equal(descriptor.migrations.filter((value) => value === path).length, 1);
});

test('stream minute deltas are materialized and repair their dependent next minute', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS sh_stream_minute_delta_read_model/);
  assert.match(migration, /PRIMARY KEY\(channel_id, minute_at\)/);
  assert.match(migration, /WITHOUT ROWID/);
  assert.match(migration, /CREATE TRIGGER IF NOT EXISTS trg_sh_stream_minute_delta_after_insert/);
  assert.match(migration, /CREATE TRIGGER IF NOT EXISTS trg_sh_stream_minute_delta_after_update/);
  assert.match(migration, /f\.minute_at-p\.minute_at=60000/);
  assert.match(migration, /f\.reported_current_stream_count>=p\.reported_current_stream_count/);
  assert.match(migration, /f\.minute_at IN \(NEW\.minute_at,NEW\.minute_at\+60000\)/);
  assert.match(migration, /ELSE NULL/);
  assert.doesNotMatch(migration, /AFTER UPDATE OF[^\n]*observed_at/);
});

test('stream delta migration backfills and maintains reset, gap, and late-correction semantics', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE sh_minute_facts(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_id INTEGER NOT NULL,
      minute_at INTEGER NOT NULL,
      observed_at INTEGER NOT NULL,
      source_code INTEGER NOT NULL,
      reported_current_stream_count INTEGER,
      UNIQUE(channel_id,minute_at)
    );
    CREATE INDEX idx_sh_minute_facts_live_minute
      ON sh_minute_facts(minute_at DESC,id DESC,channel_id)
      WHERE source_code=1;
    CREATE INDEX idx_sh_minute_facts_source_channel_minute_desc
      ON sh_minute_facts(source_code,channel_id,minute_at DESC,id DESC);
  `);

  const base = Math.floor(Date.now() / 60_000) * 60_000 - 5 * 60_000;
  const insert = db.prepare(`INSERT INTO sh_minute_facts(
    channel_id,minute_at,observed_at,source_code,reported_current_stream_count
  ) VALUES(?,?,?,?,?)`);
  insert.run(1, base, base + 1_000, 1, 100);
  insert.run(1, base + 60_000, base + 61_000, 1, 105);
  insert.run(1, base + 120_000, base + 121_000, 1, 103);

  db.exec(migration);
  const deltas = () => db.prepare(`SELECT minute_at,stream_delta
    FROM sh_stream_minute_delta_read_model WHERE channel_id=1 ORDER BY minute_at`).all()
    .map((row) => [Number(row.minute_at), row.stream_delta == null ? null : Number(row.stream_delta)]);

  assert.deepEqual(deltas(), [
    [base, null],
    [base + 60_000, 5],
    [base + 120_000, null],
  ]);

  insert.run(1, base + 180_000, base + 181_000, 1, 110);
  assert.equal(deltas().at(-1)[1], 7);

  db.prepare(`UPDATE sh_minute_facts
    SET reported_current_stream_count=108,observed_at=?
    WHERE channel_id=1 AND minute_at=?`).run(base + 122_000, base + 120_000);
  assert.deepEqual(deltas().slice(-2), [
    [base + 120_000, 3],
    [base + 180_000, 2],
  ]);

  db.prepare(`UPDATE sh_minute_facts
    SET reported_current_stream_count=90
    WHERE channel_id=1 AND minute_at=?`).run(base + 180_000);
  assert.equal(deltas().at(-1)[1], null);

  insert.run(2, base, base + 1, 1, 50);
  insert.run(2, base + 120_000, base + 120_001, 1, 60);
  const gapDelta = db.prepare(`SELECT stream_delta FROM sh_stream_minute_delta_read_model
    WHERE channel_id=2 AND minute_at=?`).get(base + 120_000)?.stream_delta;
  assert.equal(gapDelta, null);
});

test('deployment seed is bounded and Pages reads only the materialized delta table', () => {
  assert.match(migration, /unixepoch\('now','-26 hours'\)\*1000/);
  assert.doesNotMatch(migration, /DELETE FROM sh_minute_facts/);
  assert.match(dashboard, /FROM sh_stream_minute_delta_read_model AS d/);
  assert.doesNotMatch(dashboard, /FROM sh_minute_facts/);
  assert.doesNotMatch(dashboard, /reported_current_stream_count/);
});
