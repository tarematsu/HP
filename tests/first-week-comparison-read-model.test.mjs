import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { FIRST_WEEK_READ_MODEL_SQL } from '../site/functions/lib/first-week-comparison.js';

const descriptor = JSON.parse(readFileSync(
  new URL('../database/facts-db.json', import.meta.url),
  'utf8',
));
const migration = readFileSync(
  new URL('../database/facts-migrations/058_first_week_comparison_read_model.sql', import.meta.url),
  'utf8',
);

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE sh_minute_facts(
      id INTEGER PRIMARY KEY,
      minute_at INTEGER NOT NULL,
      observed_at INTEGER NOT NULL,
      channel_id INTEGER NOT NULL,
      listener_count INTEGER,
      source_code INTEGER NOT NULL,
      reported_total_listens INTEGER,
      reported_current_stream_count INTEGER
    );
    CREATE INDEX idx_sh_minute_facts_time
      ON sh_minute_facts(minute_at,id);
  `);
  return db;
}

test('first-week read model is the current MINUTE_DB schema tip', () => {
  const path = 'database/facts-migrations/058_first_week_comparison_read_model.sql';
  assert.equal(descriptor.schema, path);
  assert.equal(descriptor.migrations.at(-1), path);
  assert.equal(descriptor.migrations.filter((value) => value === path).length, 1);
});

test('migration compacts each release week into one ordered JSON row', () => {
  const db = fixture();
  const start = Date.parse('2024-09-24T15:00:00Z');
  const insert = db.prepare(`INSERT INTO sh_minute_facts(
    id,minute_at,observed_at,channel_id,listener_count,source_code,
    reported_total_listens,reported_current_stream_count
  ) VALUES(?,?,?,?,?,?,?,?)`);

  for (let index = 0; index < 6; index += 1) {
    const minuteAt = start + index * 60_000;
    insert.run(
      100 + index,
      minuteAt,
      minuteAt + 1_000,
      2,
      100 + index,
      1,
      1_000 + index,
      2_000 + index,
    );
  }
  for (let index = 0; index < 3; index += 1) {
    const minuteAt = start + index * 60_000;
    insert.run(
      200 + index,
      minuteAt,
      minuteAt + 1_000,
      1,
      50 + index,
      1,
      500 + index,
      600 + index,
    );
  }

  db.exec(migration);
  const rows = db.prepare(`SELECT release_date_jst,point_count,points_json
    FROM sh_first_week_comparison_read_model ORDER BY release_date_jst`).all();
  assert.equal(rows.length, 5);
  assert.equal(rows[0].release_date_jst, '2024-09-25');
  assert.equal(Number(rows[0].point_count), 2);
  assert.deepEqual(JSON.parse(rows[0].points_json), [
    [0, 104, 2004],
    [5, 105, 2005],
  ]);
  assert.equal(Number(rows.at(-1).point_count), 0);
  assert.deepEqual(JSON.parse(rows.at(-1).points_json), []);
});

test('public query reads only compact release rows', () => {
  assert.match(FIRST_WEEK_READ_MODEL_SQL, /sh_first_week_comparison_read_model/);
  assert.doesNotMatch(FIRST_WEEK_READ_MODEL_SQL, /sh_minute_facts|ROW_NUMBER|GROUP BY|JOIN/);
});
