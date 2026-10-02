import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

const migration = readFileSync(
  new URL('../../database/other-migrations/064_live_confirmed_follower_targets.sql', import.meta.url),
  'utf8',
);

test('dynamic follower targets require a live broadcast confirmation', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE sh_stationhead_follower_targets (
      handle TEXT PRIMARY KEY,
      source_mask INTEGER NOT NULL,
      first_seen_at INTEGER NOT NULL
    ) WITHOUT ROWID;
    INSERT INTO sh_stationhead_follower_targets(handle,source_mask,first_seen_at) VALUES
      ('fixed',1,1),
      ('historical',2,2);
  `);

  db.exec(migration);

  assert.deepEqual(
    db.prepare('SELECT handle,source_mask,live_confirmed_at FROM sh_stationhead_follower_targets ORDER BY handle').all(),
    [{ handle: 'fixed', source_mask: 1, live_confirmed_at: null }],
  );

  db.prepare(`INSERT INTO sh_stationhead_follower_targets(handle,source_mask,first_seen_at)
    VALUES(?,?,?)`).run('history-only', 2, 3);
  assert.equal(
    db.prepare('SELECT COUNT(*) AS n FROM sh_stationhead_follower_targets WHERE handle=?').get('history-only').n,
    0,
  );

  db.prepare(`INSERT INTO sh_stationhead_follower_targets(handle,source_mask,first_seen_at,live_confirmed_at)
    VALUES(?,?,?,?)`).run('livehost', 2, 4, 4);
  assert.deepEqual(
    db.prepare('SELECT source_mask,live_confirmed_at FROM sh_stationhead_follower_targets WHERE handle=?').get('livehost'),
    { source_mask: 2, live_confirmed_at: 4 },
  );
});
