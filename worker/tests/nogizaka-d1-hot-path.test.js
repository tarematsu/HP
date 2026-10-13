import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { nogizakaStationProbeDue, saveAnnouncement } from '../src/nogizaka-official-news.js';

const migration = readFileSync(
  new URL('../../database/other-migrations/054_nogizaka46smej_official_news_collection.sql', import.meta.url),
  'utf8',
);

function fixture() {
  const database = new DatabaseSync(':memory:');
  database.exec(migration);
  let dueSql = null;
  const env = {
    OTHER_DB: {
      prepare(sql) {
        if (sql.includes(' AS due')) dueSql = sql;
        const statement = database.prepare(sql);
        return {
          bind(...args) {
            return {
              async first() { return statement.get(...args) ?? null; },
              async run() { return statement.run(...args); },
            };
          },
        };
      },
    },
  };
  return { database, env, dueSql: () => dueSql };
}

test('repeated identical time-unknown articles do not write or advance updated_at', async () => {
  const { database, env } = fixture();
  const article = {
    newsId: 'example-news', href: 'https://www.nogizaka46.com/s/n46/news/detail/example-news',
    publishedDate: null, title: 'Stationhead announcement',
    eventName: 'Stationhead announcement', text: 'Stationhead date pending',
  };
  assert.equal(await saveAnnouncement(env, article, null, 1000), 1);
  assert.equal(await saveAnnouncement(env, article, null, 2000), 1);
  let rows = database.prepare('SELECT news_id,status,updated_at,raw_text FROM sh_nogizaka_official_news_announcements').all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].updated_at, 1000);
  assert.equal(rows[0].raw_text, article.text);
  assert.equal(rows[0].status, 'time_unknown');

  assert.equal(await saveAnnouncement(env, { ...article, text: 'Stationhead new details' }, null, 3000), 1);
  rows = database.prepare('SELECT updated_at,raw_text FROM sh_nogizaka_official_news_announcements').all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].updated_at, 3000);
  assert.equal(rows[0].raw_text, 'Stationhead new details');
  database.close();
});

test('scheduled and active announcements use indexed existence probes without losing eligibility', async () => {
  const { database, env, dueSql } = fixture();
  const now = Date.UTC(2026, 9, 14, 12, 0);
  assert.equal(await nogizakaStationProbeDue(env, now), false);

  database.prepare(`INSERT INTO sh_nogizaka_official_news_announcements
    (news_id,news_url,title,event_name,scheduled_at,detected_at,updated_at,status)
    VALUES (?,?,?,?,?,?,?,?)`).run(
    'news-1', 'https://example.test/1', 'News', 'Event', now + 60_000, now, now, 'scheduled',
  );
  assert.equal(await nogizakaStationProbeDue(env, now), false, 'future scheduled event');
  assert.equal(await nogizakaStationProbeDue(env, now + 60_000), true, 'due scheduled event');

  database.exec("UPDATE sh_nogizaka_official_news_announcements SET status='ended'");
  assert.equal(await nogizakaStationProbeDue(env, now + 60_000), false, 'ended event');
  database.exec("UPDATE sh_nogizaka_official_news_announcements SET status='active'");
  assert.equal(await nogizakaStationProbeDue(env, now), true, 'active event');
  database.exec('UPDATE sh_nogizaka_official_news_announcements SET scheduled_at=NULL');
  assert.equal(await nogizakaStationProbeDue(env, now), false, 'undated active event');

  const plan = database.prepare('EXPLAIN QUERY PLAN ' + dueSql()).all(now - 90 * 60_000, now)
    .map(row => row.detail).join('\n');
  assert.match(plan, /idx_sh_nogizaka_official_news_schedule/);
  database.close();
});
