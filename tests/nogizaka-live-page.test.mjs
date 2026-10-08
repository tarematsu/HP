import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { onRequestGet } from '../site/functions/api/nogizaka46smej-status.js';

const html = readFileSync(new URL('../site/public/nogizaka46smej/index.html', import.meta.url), 'utf8');
const client = readFileSync(new URL('../site/public/official-account-live.js', import.meta.url), 'utf8');
const api = readFileSync(new URL('../site/functions/api/nogizaka46smej-status.js', import.meta.url), 'utf8');
const common = readFileSync(new URL('../site/functions/lib/official-account-status.js', import.meta.url), 'utf8');

function fakeDb({ event = null, samples = [], statements = [] } = {}) {
  return {
    prepare(sql) {
      statements.push(sql);
      return {
        bind() { return this; },
        async first() {
          assert.match(sql, /sh_nogizaka_official_news_announcements/);
          return event;
        },
        async all() {
          assert.match(sql, /sh_nogizaka46smej_main/);
          return { results: samples };
        },
      };
    },
  };
}

test('Nogizaka realtime page uses the shared official-account shell', () => {
  assert.match(html, /data-handle="nogizaka46smej"/);
  assert.match(html, /data-api="\/api\/nogizaka46smej-status"/);
  assert.match(html, /\/assets\/official\.min\.css/);
  assert.match(html, /\/assets\/official-account-live\.min\.js/);
  assert.match(client, /collection_active \? 15_000 : 60_000/);
  assert.match(client, /visibilitychange/);
});

test('Nogizaka realtime API shares status policy while keeping isolated source tables', () => {
  assert.match(api, /official-account-status\.js/);
  assert.match(api, /sh_nogizaka_official_news_announcements/);
  assert.match(api, /sh_nogizaka46smej_main/);
  assert.doesNotMatch(api, /sh_official_news_announcements\b|sh_sakurazaka46jp_main/);
  assert.match(common, /listener_count/);
  assert.match(common, /total_listens/);
  assert.match(common, /followers/);
  assert.match(common, /sh_sakurazaka46jp_collection_tests/);
});

test('active Nogizaka collection returns shared realtime contract and cache policy', async () => {
  const observedAt = Date.now() - 5_000;
  const statements = [];
  const response = await onRequestGet({
    env: {
      OTHER_DB: fakeDb({
        statements,
        event: { id: 7, event_name: '乃木坂46 Stationhead', status: 'active', scheduled_at: observedAt },
        samples: [{
          observed_at: observedAt,
          listener_count: 347,
          total_listens: 1200,
          guest_count: 0,
          followers: 347,
        }],
      }),
    },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.handle, 'nogizaka46smej');
  assert.equal(body.collection_active, true);
  assert.equal(body.refresh_hint_ms, 15000);
  assert.equal(body.latest.listener_count, 347);
  assert.equal(body.sample_count, 1);
  const mainSql = statements.find((sql) => sql.includes('sh_nogizaka46smej_main'));
  assert.match(mainSql, /target_handle='nogizaka46smej'/);
});

function sqlDb(events) {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE sh_nogizaka_official_news_announcements (
    id INTEGER, event_name TEXT, scheduled_at INTEGER,
    first_broadcast_at INTEGER, last_broadcast_at INTEGER, status TEXT)`);
  const insert = db.prepare(`INSERT INTO sh_nogizaka_official_news_announcements
    VALUES (?,?,?,NULL,NULL,?)`);
  for (const row of events) insert.run(...row);
  return {
    close() { db.close(); },
    prepare(sql) {
      let args = [];
      return {
        bind(...values) { args = values; return this; },
        async first() { return db.prepare(sql).get(...args); },
        async all() { return { results: [] }; },
      };
    },
  };
}

test('start-waiting display ignores stale schedules but retains the shared delayed-start window', async () => {
  const now = Date.now();
  const db = sqlDb([
    [1, 'old campaign', now - 2 * 86400000, 'scheduled'],
    [2, 'delayed broadcast', now - 30 * 60000, 'scheduled'],
    [3, 'next broadcast', now + 60000, 'scheduled'],
    [4, 'invalid campaign', now, 'invalid'],
  ]);
  try {
    const body = await (await onRequestGet({ env: { OTHER_DB: db } })).json();
    assert.equal(body.event.id, 2);
    assert.equal(body.collection_active, false);
    const next = await (await onRequestGet({ env: {
      OTHER_DB: db, OFFICIAL_NEWS_LATE_WINDOW_MS: 10 * 60000,
    } })).json();
    assert.equal(next.event.id, 3);
  } finally { db.close(); }
});

test('active broadcast takes priority and an expired-only schedule is hidden', async () => {
  const now = Date.now();
  for (const active of [false, true]) {
    const rows = [[1, 'expired', now - 2 * 86400000, 'scheduled']];
    if (active) rows.push([2, 'ongoing', now - 3 * 3600000, 'active']);
    const db = sqlDb(rows);
    try {
      const body = await (await onRequestGet({ env: { OTHER_DB: db } })).json();
      assert.equal(body.event?.id ?? null, active ? 2 : null);
      assert.equal(body.collection_active, active);
    } finally { db.close(); }
  }
});
