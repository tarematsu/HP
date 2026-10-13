import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import {
  WEEKLY_RANKING_FEATURED_HOST_SQL,
  WEEKLY_RANKING_FANDOM_HOST_SQL,
} from '../src/weekly-ranking-materializer.js';

const newIndex = readFileSync(
  new URL('../../database/other-migrations/073_weekly_ranking_normalized_host_lookup.sql', import.meta.url),
  'utf8',
);

test('weekly featured-host lookups preserve trimmed case-insensitive results and use indexed seeks', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`
      CREATE TABLE sh_channel_rankings(
        id INTEGER PRIMARY KEY, ranking_date TEXT, observed_at INTEGER,
        ranking_type TEXT, rank INTEGER, channel_name TEXT, channel_alias TEXT,
        source_sheet TEXT, quality_score REAL, quality_flags TEXT
      );
      CREATE TABLE sh_channel_fandoms(
        host_name TEXT PRIMARY KEY COLLATE NOCASE, artist_name TEXT, relation_type TEXT
      );
      CREATE INDEX idx_sh_channel_fandoms_host_normalized
        ON sh_channel_fandoms(lower(trim(host_name)));
      CREATE INDEX idx_other_channel_rankings_featured_date_rank
        ON sh_channel_rankings(lower(channel_name),ranking_date,rank);
    `);
    db.exec(newIndex);
    db.exec(newIndex);
    for (let i = 0; i < 350; i += 1) {
      db.prepare(`INSERT INTO sh_channel_rankings
        (ranking_date,observed_at,ranking_type,rank,channel_name,channel_alias,source_sheet,quality_score,quality_flags)
        VALUES (?,?,?,?,?,?,?,?,?)`)
        .run('2026-10-12', i, '週間リーダーボード', i + 1, `other_host_${i}`, `other_host_${i}`, 'weekly', 1, '');
      db.prepare('INSERT INTO sh_channel_fandoms VALUES (?,?,?)')
        .run(`other_host_${i}`, 'unrelated', 'fandom');
    }
    db.exec(`
      INSERT INTO sh_channel_rankings
        (ranking_date,observed_at,ranking_type,rank,channel_name,channel_alias,source_sheet,quality_score,quality_flags)
      VALUES
        ('2026-10-05',1,'週間リーダーボード',5,' SakuraMankai ','SakuraMankai','weekly',1,''),
        ('2026-10-12',2,'週間リーダーボード',7,'sakURAzaka46jp','sakURAzaka46jp','weekly',1,''),
        ('2026-10-12',3,'週間リーダーボード',8,'nogizaka46smej','nogizaka46smej','weekly',1,'');
      INSERT INTO sh_channel_fandoms VALUES
        (' SakuraMankai ','櫻坂46','fandom'),
        ('sakURAzaka46jp','櫻坂46','official'),
        ('nogizaka46smej','乃木坂46','official');
    `);

    const beforeRanking = WEEKLY_RANKING_FEATURED_HOST_SQL
      .replace(' INDEXED BY idx_other_channel_rankings_trimmed_host_date_rank', '');
    const beforeFandom = WEEKLY_RANKING_FANDOM_HOST_SQL
      .replace(' INDEXED BY idx_sh_channel_fandoms_host_normalized', '');
    const normalized = (rows) => rows.map(row => ({ ...row }));
    assert.deepEqual(normalized(db.prepare(WEEKLY_RANKING_FEATURED_HOST_SQL).all()),
      normalized(db.prepare(beforeRanking).all()));
    assert.deepEqual(normalized(db.prepare(WEEKLY_RANKING_FANDOM_HOST_SQL).all()),
      normalized(db.prepare(beforeFandom).all()));
    assert.equal(db.prepare(WEEKLY_RANKING_FEATURED_HOST_SQL).all().length, 3);
    assert.equal(db.prepare(WEEKLY_RANKING_FANDOM_HOST_SQL).all().length, 3);

    const rankPlan = db.prepare('EXPLAIN QUERY PLAN ' + WEEKLY_RANKING_FEATURED_HOST_SQL)
      .all().map(row => row.detail).join('\n');
    const fandomPlan = db.prepare('EXPLAIN QUERY PLAN ' + WEEKLY_RANKING_FANDOM_HOST_SQL)
      .all().map(row => row.detail).join('\n');
    assert.match(rankPlan, /SEARCH sh_channel_rankings USING INDEX idx_other_channel_rankings_trimmed_host_date_rank/);
    assert.match(fandomPlan, /SEARCH sh_channel_fandoms USING INDEX idx_sh_channel_fandoms_host_normalized/);
    assert.doesNotMatch(rankPlan, /SCAN sh_channel_rankings/);
    assert.doesNotMatch(fandomPlan, /SCAN sh_channel_fandoms/);
  } finally {
    db.close();
  }
});
