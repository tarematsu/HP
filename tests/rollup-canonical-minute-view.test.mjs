import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

const migration = readFileSync(
  new URL('../database/facts-migrations/051_canonical_rollup_minute_range.sql', import.meta.url),
  'utf8',
);
const manifest = JSON.parse(readFileSync(
  new URL('../database/facts-db.json', import.meta.url),
  'utf8',
));

test('facts schema deploys the canonical rollup minute view', () => {
  assert.equal(
    manifest.schema,
    'database/facts-migrations/051_canonical_rollup_minute_range.sql',
  );
  assert.equal(
    manifest.migrations.at(-1),
    'database/facts-migrations/051_canonical_rollup_minute_range.sql',
  );
  assert.match(migration, /f\.minute_at AS observed_at/);
  assert.match(migration, /INDEXED BY idx_sh_minute_facts_time/);
  assert.match(migration, /d\.day_at=\(f\.minute_at\/86400000\)\*86400000/);
  assert.doesNotMatch(migration, /ANALYZE|PRAGMA optimize|CREATE INDEX/);
});

test('rollup compatibility view excludes today-imported historical facts and seeks minute_at', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE sh_minute_facts(
      id INTEGER PRIMARY KEY,
      minute_at INTEGER NOT NULL,
      observed_at INTEGER NOT NULL,
      channel_id INTEGER NOT NULL,
      is_broadcasting INTEGER,
      listener_count INTEGER,
      online_member_count INTEGER,
      total_member_count INTEGER,
      guest_count INTEGER,
      reported_total_listens INTEGER,
      reported_current_stream_count INTEGER,
      comment_count INTEGER
    );
    CREATE INDEX idx_sh_minute_facts_time
      ON sh_minute_facts(minute_at ASC,id ASC);
    CREATE TABLE sh_minute_fact_context(
      fact_id INTEGER PRIMARY KEY,
      station_id INTEGER,
      host_id INTEGER,
      broadcast_start_time INTEGER
    );
    CREATE TABLE sh_hosts(
      id INTEGER PRIMARY KEY,
      stationhead_account_id INTEGER,
      current_handle TEXT
    );
    CREATE TABLE sh_total_member_daily_latest(
      channel_id INTEGER,
      day_at INTEGER,
      last_total_member_count INTEGER
    );
  `);
  db.exec(migration);

  const day = Date.parse('2026-08-22T00:00:00Z');
  const historicalMinute = Date.parse('2026-08-20T12:00:00Z');
  const currentMinute = day + 15 * 60_000;
  const importedToday = day + 20 * 60_000;
  const insert = db.prepare(`INSERT INTO sh_minute_facts(
    id,minute_at,observed_at,channel_id,is_broadcasting,listener_count,
    online_member_count,total_member_count,guest_count,reported_total_listens,
    reported_current_stream_count,comment_count
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`);
  insert.run(1, historicalMinute, importedToday, 1, 1, 100, 80, 200, 20, 1000, 500, 1);
  insert.run(2, currentMinute, currentMinute, 1, 1, 110, 85, 201, 25, 1010, 510, 2);

  const rows = db.prepare(`SELECT id,observed_at FROM sh_channel_snapshots
    WHERE observed_at>=? AND observed_at<? ORDER BY observed_at ASC,id ASC`)
    .all(day, day + 86_400_000)
    .map((row) => ({ id: Number(row.id), observed_at: Number(row.observed_at) }));
  assert.deepEqual(rows, [{ id: 2, observed_at: currentMinute }]);

  const plan = db.prepare(`EXPLAIN QUERY PLAN SELECT id FROM sh_channel_snapshots
    WHERE observed_at>=? AND observed_at<? ORDER BY observed_at ASC,id ASC`)
    .all(day, day + 86_400_000)
    .map((row) => String(row.detail || ''))
    .join('\n');
  assert.match(plan, /idx_sh_minute_facts_time/);
  assert.doesNotMatch(plan, /SCAN f(?:\s|$)/);
});
