import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

const migration = readFileSync(
  new URL('../database/facts-migrations/046_track_minute_fact_pending_age.sql', import.meta.url),
  'utf8',
);

test('pending age follows inbox wait time for historical rebuild jobs', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE sh_minute_fact_jobs (
    id INTEGER PRIMARY KEY,
    minute_at INTEGER NOT NULL,
    status TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`);
  db.prepare(`INSERT INTO sh_minute_fact_jobs(id,minute_at,status,updated_at)
    VALUES(?,?,?,?)`).run(1, 1_000, 'pending', 900_000);

  db.exec(migration);
  assert.equal(
    db.prepare(`SELECT oldest_pending_at FROM sh_minute_fact_pending_age
      WHERE id='global'`).get().oldest_pending_at,
    900_000,
  );

  db.prepare(`INSERT INTO sh_minute_fact_jobs(id,minute_at,status,updated_at)
    VALUES(?,?,?,?)`).run(2, 2_000, 'pending', 1_000_000);
  db.prepare(`UPDATE sh_minute_fact_jobs SET status='processing',updated_at=?
    WHERE id=?`).run(1_100_000, 1);
  assert.equal(
    db.prepare(`SELECT oldest_pending_at FROM sh_minute_fact_pending_age
      WHERE id='global'`).get().oldest_pending_at,
    1_000_000,
  );

  db.prepare(`UPDATE sh_minute_fact_jobs SET updated_at=? WHERE id=?`)
    .run(1_200_000, 2);
  assert.equal(
    db.prepare(`SELECT oldest_pending_at FROM sh_minute_fact_pending_age
      WHERE id='global'`).get().oldest_pending_at,
    1_200_000,
  );

  // Replaying the deploy-safe migration rebuilds the aggregate and triggers.
  db.exec(migration);
  assert.equal(
    db.prepare(`SELECT oldest_pending_at FROM sh_minute_fact_pending_age
      WHERE id='global'`).get().oldest_pending_at,
    1_200_000,
  );
});
