import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

const migration = readFileSync(
  new URL('../database/other-migrations/024_persist_daily_member_growth.sql', import.meta.url),
  'utf8',
);

function createDatabase() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE sh_daily_summary (
    period_key TEXT PRIMARY KEY,
    member_start INTEGER,
    member_end INTEGER,
    member_growth INTEGER
  )`);
  db.exec(`INSERT INTO sh_daily_summary(period_key,member_start,member_end,member_growth) VALUES
    ('2024-01-01',90,100,10),
    ('2024-01-02',110,110,0),
    ('2024-01-03',120,120,0)`);
  return db;
}

function memberRow(db, key) {
  return db.prepare(`SELECT member_start,member_end,member_growth
    FROM sh_daily_summary WHERE period_key=?`).get(key);
}

test('daily member migration persists historical correction exactly once', () => {
  const db = createDatabase();
  try {
    db.exec(migration);
    assert.deepEqual(memberRow(db, '2024-01-02'), {
      member_start: 100,
      member_end: 110,
      member_growth: 10,
    });
    assert.deepEqual(memberRow(db, '2024-01-03'), {
      member_start: 110,
      member_end: 120,
      member_growth: 10,
    });
    assert.equal(
      db.prepare(`SELECT COUNT(*) AS count FROM sh_data_repairs
        WHERE id='daily-member-growth-v1'`).get().count,
      1,
    );

    db.exec(`UPDATE sh_daily_summary
      SET member_start=777,member_growth=777
      WHERE period_key='2024-01-02'`);
    db.exec(migration);
    assert.deepEqual(memberRow(db, '2024-01-02'), {
      member_start: 777,
      member_end: 110,
      member_growth: 777,
    });
  } finally {
    db.close();
  }
});

test('daily member triggers normalize future rows when they are stored', () => {
  const db = createDatabase();
  try {
    db.exec(migration);
    db.exec(`INSERT INTO sh_daily_summary(period_key,member_start,member_end,member_growth)
      VALUES('2024-01-04',130,135,5)`);
    assert.deepEqual(memberRow(db, '2024-01-04'), {
      member_start: 120,
      member_end: 135,
      member_growth: 15,
    });

    db.exec(`UPDATE sh_daily_summary SET member_end=140 WHERE period_key='2024-01-04'`);
    assert.deepEqual(memberRow(db, '2024-01-04'), {
      member_start: 120,
      member_end: 140,
      member_growth: 20,
    });
  } finally {
    db.close();
  }
});
