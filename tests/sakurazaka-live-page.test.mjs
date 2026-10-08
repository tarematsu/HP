import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { onRequestGet } from '../site/functions/api/sakurazaka46jp-status.js';

const html = readFileSync(new URL('../site/public/sakurazaka46jp/index.html', import.meta.url), 'utf8');
const client = readFileSync(new URL('../site/public/official-account-live.js', import.meta.url), 'utf8');
const api = readFileSync(new URL('../site/functions/api/sakurazaka46jp-status.js', import.meta.url), 'utf8');
const common = readFileSync(new URL('../site/functions/lib/official-account-status.js', import.meta.url), 'utf8');

function fakeDb({ event = null, samples = [], statements = [] } = {}) {
  return {
    prepare(sql) {
      statements.push(sql);
      return {
        bind() { return this; },
        async first() {
          assert.match(sql, /sh_official_news_announcements/);
          return event;
        },
        async all() {
          if (sql.includes('sh_sakurazaka46jp_main')) return { results: samples };
          throw new Error(`unexpected SQL: ${sql}`);
        },
      };
    },
  };
}

test('Sakurazaka realtime page uses the shared official-account shell', () => {
  assert.match(html, /data-handle="sakurazaka46jp"/);
  assert.match(html, /data-api="\/api\/sakurazaka46jp-status"/);
  assert.match(html, /\/assets\/official\.min\.css/);
  assert.match(html, /\/assets\/official-account-live\.min\.js/);
  assert.match(client, /collection_active \? 15_000 : 60_000/);
  assert.match(client, /visibilitychange/);
});

test('Sakurazaka realtime API uses shared policy and has no chat status payload', () => {
  assert.match(api, /official-account-status\.js/);
  assert.match(api, /sh_official_news_announcements/);
  assert.match(api, /sh_sakurazaka46jp_main/);
  assert.doesNotMatch(api, /sh_sakurazaka46jp_chat|latest_chat|chat_sample_count|chat_recent_limit/);
  assert.match(common, /sh_sakurazaka46jp_collection_tests/);
  assert.match(common, /scheduled_at>=\?/);
  assert.match(common, /cache-control': OFFICIAL_STATUS_CACHE_CONTROL/);
});

test('active Sakurazaka collection returns shared realtime contract without chat fields', async () => {
  const observedAt = Date.now() - 5_000;
  const statements = [];
  const response = await onRequestGet({
    env: {
      OTHER_DB: fakeDb({
        statements,
        event: { id: 7, event_name: '櫻坂46 Stationhead', status: 'active', scheduled_at: observedAt },
        samples: [{
          observed_at: observedAt,
          listener_count: 347,
          total_listens: 1200,
          guest_count: 0,
          followers: 46000,
        }],
      }),
    },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.handle, 'sakurazaka46jp');
  assert.equal(body.collection_active, true);
  assert.equal(body.refresh_hint_ms, 15000);
  assert.equal(body.latest.listener_count, 347);
  assert.equal(body.latest_main.listener_count, 347);
  assert.equal(body.sample_count, 1);
  assert.equal('latest_chat' in body, false);
  assert.equal('chats' in body, false);
  assert.equal('chat_sample_count' in body, false);
  const mainSql = statements.find((sql) => sql.includes('sh_sakurazaka46jp_main'));
  assert.match(mainSql, /target_handle='sakurazaka46jp'/);
});
