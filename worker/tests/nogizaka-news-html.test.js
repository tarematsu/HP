import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { parseNogizakaNewsArticle } from '../src/nogizaka-news-html.js';
import { runNogizakaNewsDetailStage, nogizakaOfficialNewsConfig } from '../src/nogizaka-official-news.js';

// Reduced official-page topology: navigation and latest news are inside article.
function page(title, body) {
  return `<title>Unrelated document title</title><header class="post_header">
    <h1>${title}</h1><div class="post_header_data"><span>2026.09.29</span></div>
    </header><article class="area post_body"><div class="post_body_in">
    ${body}</div><div class="post_navi">STATIONHEAD 2026年10月4日23:59</div>
    <div class="latest_newslist">STATIONHEAD 2026年10月5日18:00</div></article>`;
}
function database() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../../database/other-migrations/054_nogizaka46smej_official_news_collection.sql', import.meta.url), 'utf8'));
  return { db, env: { OTHER_DB: { prepare(sql) {
    let args = [];
    return {
      bind(...values) { args = values; return this; },
      async run() { return db.prepare(sql).run(...args); },
      async first() { return db.prepare(sql).get(...args); },
    };
  } } } };
}
const cfg = nogizakaOfficialNewsConfig();
const now = Date.UTC(2026, 8, 30, 12);

function insert(db, newsId, status, broadcast = null) {
  db.prepare(`INSERT INTO sh_nogizaka_official_news_announcements
    (news_id,news_url,title,event_name,scheduled_at,detected_at,updated_at,status,first_broadcast_at)
    VALUES (?,'url','title','event',?,?,?, ?,?)`).run(newsId, now, now, now, status, broadcast);
}

test('article extraction excludes navigation, latest news, comments and scripts, retaining nested body divs', () => {
  const parsed = parseNogizakaNewsArticle(page('Stationhead',
    '<div>開催日時<br><div>2026年9月30日（水）21:30～</div></div><p>参加案内</p>'
    + '<script>"</div>"</script><!-- </div> -->'));
  assert.equal(parsed.title, 'Stationhead');
  assert.equal(parsed.publishedDate, '2026-09-29');
  assert.match(parsed.text, /21:30/);
  assert.match(parsed.text, /参加案内/);
  assert.doesNotMatch(parsed.text, /10月|STATIONHEAD|script/);
  assert.throws(() => parseNogizakaNewsArticle('<h1>Stationhead</h1>2026年9月30日21:30'), /structure unavailable/);
  assert.throws(() => parseNogizakaNewsArticle(page('Title', '').replace('post_body_in', 'changed')), /structure unavailable/);
});

test('real announcement persists only the article time, ignoring sidebar times', async () => {
  const { db, env } = database();
  try {
    const result = await runNogizakaNewsDetailStage(env, cfg, now,
      { newsId: '102280', href: 'https://www.nogizaka46.com/s/n46/news/detail/102280' },
      { fetch: async () => new Response(page('Stationhead 開催', '<div>2026年9月30日（水）21:30～</div>')) });
    assert.equal(result.saved, 1);
    const rows = db.prepare('SELECT * FROM sh_nogizaka_official_news_announcements').all();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].scheduled_at, Date.UTC(2026, 8, 30, 12, 30));
    assert.equal(rows[0].published_date, '2026-09-29');
  } finally { db.close(); }
});

test('unrelated article invalidates uncollected false positives and preserves collected history', async () => {
  const { db, env } = database();
  try {
    insert(db, '102277', 'scheduled');
    insert(db, 'history', 'active', now);
    const dependencies = { fetch: async () => new Response(page('レターキャンペーン', '2026年9月28日18:00')) };
    for (const newsId of ['102277', 'history']) {
      const result = await runNogizakaNewsDetailStage(env, cfg, now, { newsId, href: 'url' }, dependencies);
      assert.equal(result.reason, 'not-stationhead');
      assert.equal(result.saved, 0);
    }
    assert.deepEqual(db.prepare('SELECT status FROM sh_nogizaka_official_news_announcements ORDER BY id').all().map(r => r.status), ['invalid', 'active']);
  } finally { db.close(); }
});

test('campaign migration is repeatable and preserves real announcements and collected rows', () => {
  const { db } = database();
  try {
    insert(db, '102277', 'scheduled');
    insert(db, '102280', 'scheduled');
    db.prepare('UPDATE sh_nogizaka_official_news_announcements SET scheduled_at=? WHERE news_id=?').run(now - 1, '102277');
    insert(db, '102277', 'ended', now);
    const sql = readFileSync(new URL('../../database/other-migrations/060_invalidate_nogizaka_campaign_announcement.sql', import.meta.url), 'utf8');
    db.exec(sql); db.exec(sql);
    assert.deepEqual(db.prepare('SELECT status FROM sh_nogizaka_official_news_announcements ORDER BY id').all().map(r => r.status), ['invalid', 'scheduled', 'ended']);
  } finally { db.close(); }
});
