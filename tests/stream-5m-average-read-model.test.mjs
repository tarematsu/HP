import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

const descriptor = JSON.parse(readFileSync(
  new URL('../database/facts-db.json', import.meta.url),
  'utf8',
));
const minuteMigration = readFileSync(
  new URL('../database/facts-migrations/056_stream_minute_delta_read_model.sql', import.meta.url),
  'utf8',
);
const averageMigration = readFileSync(
  new URL('../database/facts-migrations/057_stream_5m_average_read_model.sql', import.meta.url),
  'utf8',
);
const dashboard = readFileSync(
  new URL('../site/functions/lib/dashboard-chart-support.js', import.meta.url),
  'utf8',
);

function fixture() {
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
  return db;
}

function readAverages(db) {
  return db.prepare(`SELECT bucket_at,stream_delta_avg,sample_count
    FROM sh_stream_5m_average_read_model WHERE channel_id=1 ORDER BY bucket_at`).all()
    .map((row) => ({
      bucket_at: Number(row.bucket_at),
      stream_delta_avg: Number(row.stream_delta_avg),
      sample_count: Number(row.sample_count),
    }));
}

test('five-minute stream average migration remains ordered before the current MINUTE_DB schema tip', () => {
  const path = 'database/facts-migrations/057_stream_5m_average_read_model.sql';
  const index = descriptor.migrations.indexOf(path);
  assert.ok(index >= 0);
  assert.ok(index < descriptor.migrations.length - 1);
  assert.equal(descriptor.migrations.filter((value) => value === path).length, 1);
});

test('five-minute migration retires the one-minute intermediate model', () => {
  assert.match(averageMigration, /CREATE TABLE IF NOT EXISTS sh_stream_5m_average_read_model/);
  assert.match(averageMigration, /HAVING COUNT\(\*\)=5/);
  assert.match(averageMigration, /DROP TRIGGER IF EXISTS trg_sh_stream_minute_delta_after_insert/);
  assert.match(averageMigration, /DROP TRIGGER IF EXISTS trg_sh_stream_minute_delta_after_update/);
  assert.match(averageMigration, /DROP TABLE IF EXISTS sh_stream_minute_delta_read_model/);
  assert.match(averageMigration, /CREATE TRIGGER IF NOT EXISTS trg_sh_stream_5m_average_after_insert/);
  assert.match(averageMigration, /CREATE TRIGGER IF NOT EXISTS trg_sh_stream_5m_average_after_update/);
});

test('five valid minute deltas materialize one average and invalid buckets fail closed', () => {
  const db = fixture();
  const bucket = Math.floor(Date.now() / 300_000) * 300_000 - 600_000;
  const insert = db.prepare(`INSERT INTO sh_minute_facts(
    channel_id,minute_at,observed_at,source_code,reported_current_stream_count
  ) VALUES(?,?,?,?,?)`);

  const initial = [100, 102, 105, 109, 114, 120];
  for (let index = 0; index < initial.length; index += 1) {
    const minuteAt = bucket - 60_000 + index * 60_000;
    insert.run(1, minuteAt, minuteAt + 1_000, 1, initial[index]);
  }

  db.exec(minuteMigration);
  db.exec(averageMigration);
  assert.deepEqual(readAverages(db), [{
    bucket_at: bucket,
    stream_delta_avg: 4,
    sample_count: 5,
  }]);
  assert.equal(
    db.prepare(`SELECT COUNT(*) AS n FROM sqlite_master
      WHERE name='sh_stream_minute_delta_read_model'`).get().n,
    0,
  );

  const next = [121, 123, 126, 130, 135];
  for (let index = 0; index < next.length; index += 1) {
    const minuteAt = bucket + 300_000 + index * 60_000;
    insert.run(1, minuteAt, minuteAt + 1_000, 1, next[index]);
  }
  assert.deepEqual(readAverages(db), [
    { bucket_at: bucket, stream_delta_avg: 4, sample_count: 5 },
    { bucket_at: bucket + 300_000, stream_delta_avg: 3, sample_count: 5 },
  ]);

  db.prepare(`UPDATE sh_minute_facts SET reported_current_stream_count=90
    WHERE channel_id=1 AND minute_at=?`).run(bucket + 120_000);
  assert.deepEqual(readAverages(db), [
    { bucket_at: bucket + 300_000, stream_delta_avg: 3, sample_count: 5 },
  ]);

  db.prepare(`UPDATE sh_minute_facts SET reported_current_stream_count=109
    WHERE channel_id=1 AND minute_at=?`).run(bucket + 120_000);
  assert.equal(readAverages(db)[0].bucket_at, bucket);

  db.prepare(`UPDATE sh_minute_facts SET reported_current_stream_count=121
    WHERE channel_id=1 AND minute_at=?`).run(bucket + 240_000);
  const repaired = readAverages(db);
  assert.equal(repaired[0].stream_delta_avg, 4.2);
  assert.equal(repaired[1].stream_delta_avg, 2.8);
});

test('Pages reads only the final five-minute average model', () => {
  assert.match(dashboard, /FROM sh_stream_5m_average_read_model AS d/);
  assert.match(dashboard, /stream_5m_history/);
  assert.doesNotMatch(dashboard, /sh_stream_minute_delta_read_model/);
  assert.doesNotMatch(dashboard, /FROM sh_minute_facts|AVG\(|GROUP BY/);
});
