import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

const migration = readFileSync(
  new URL('../database/other-migrations/025_normalize_weekly_ranking_mondays.sql', import.meta.url),
  'utf8',
);

function createDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE sh_channel_rankings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ranking_date TEXT NOT NULL,
      ranking_type TEXT NOT NULL
    );
  `);
  return db;
}

function rankingRows(db) {
  return db.prepare('SELECT ranking_date, ranking_type FROM sh_channel_rankings ORDER BY id')
    .all()
    .map((row) => ({ ...row }));
}

test('existing weekly leaderboard source dates are normalized to Monday', () => {
  const db = createDb();
  try {
    db.exec(`
      INSERT INTO sh_channel_rankings(ranking_date, ranking_type) VALUES
        ('2026-01-26', '週間リーダーボード'),
        ('2026-01-27', '週間リーダーボード'),
        ('2026-01-28', '週間リーダーボード'),
        ('2026-01-28', '日次ランキング');
    `);

    db.exec(migration);
    assert.deepEqual(rankingRows(db), [
      { ranking_date: '2026-01-26', ranking_type: '週間リーダーボード' },
      { ranking_date: '2026-01-26', ranking_type: '週間リーダーボード' },
      { ranking_date: '2026-01-26', ranking_type: '週間リーダーボード' },
      { ranking_date: '2026-01-28', ranking_type: '日次ランキング' },
    ]);

    db.exec(migration);
    assert.deepEqual(rankingRows(db).slice(0, 3).map((row) => row.ranking_date), [
      '2026-01-26', '2026-01-26', '2026-01-26',
    ]);
  } finally {
    db.close();
  }
});

test('future weekly leaderboard inserts and updates are kept on Monday', () => {
  const db = createDb();
  try {
    db.exec(migration);

    db.exec(`INSERT INTO sh_channel_rankings(ranking_date, ranking_type)
      VALUES ('2026-09-20', '週間リーダーボード')`);
    assert.equal(
      db.prepare('SELECT ranking_date FROM sh_channel_rankings WHERE id=1').get().ranking_date,
      '2026-09-14',
    );

    db.exec(`INSERT INTO sh_channel_rankings(ranking_date, ranking_type)
      VALUES ('2026-09-23', '日次ランキング')`);
    db.exec(`UPDATE sh_channel_rankings SET ranking_type='週間リーダーボード' WHERE id=2`);
    assert.equal(
      db.prepare('SELECT ranking_date FROM sh_channel_rankings WHERE id=2').get().ranking_date,
      '2026-09-21',
    );
  } finally {
    db.close();
  }
});
