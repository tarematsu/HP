import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { onRequestGet } from '../site/functions/api/sakurazaka46jp-status.js';

const html = readFileSync(new URL('../site/public/sakurazaka46jp/index.html', import.meta.url), 'utf8');
const client = readFileSync(new URL('../site/public/sakurazaka46jp/live.js', import.meta.url), 'utf8');
const api = readFileSync(new URL('../site/functions/api/sakurazaka46jp-status.js', import.meta.url), 'utf8');

function fakeDb({ event = null, samples = [] } = {}) {
  return {
    prepare(sql) {
      return {
        async first() {
          assert.match(sql, /sh_official_news_announcements/);
          return event;
        },
        async all() {
          if (sql.includes('sh_sakurazaka46jp_main')) return { results: samples };
          if (sql.includes('sh_sakurazaka46jp_chat')) return { results: [] };
          throw new Error(`unexpected SQL: ${sql}`);
        },
      };
    },
  };
}

test('Sakurazaka realtime page matches the official-account realtime view', () => {
  assert.match(html, /sakurazaka46jp/);
  assert.match(html, /リアルタイム数値/);
  assert.match(html, /\/sakurazaka46jp\/live\.js/);
  assert.match(client, /\/api\/sakurazaka46jp-status/);
  assert.match(client, /collection_active \? 15000 : 60000/);
});

test('Sakurazaka realtime API exposes follower data and compatibility aliases', () => {
  assert.match(api, /sh_official_news_announcements/);
  assert.match(api, /sh_sakurazaka46jp_main/);
  assert.match(api, /followers/);
  assert.match(api, /latest_main: latestMain/);
  assert.match(api, /latest: latestMain/);
  assert.match(api, /refresh_hint_ms/);
});

test('active Sakurazaka collection returns realtime samples with a short refresh hint', async () => {
  const observedAt = Date.now() - 5_000;
  const response = await onRequestGet({
    env: {
      OTHER_DB: fakeDb({
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
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.handle, 'sakurazaka46jp');
  assert.equal(body.collection_active, true);
  assert.equal(body.refresh_hint_ms, 15000);
  assert.equal(body.latest.listener_count, 347);
  assert.equal(body.latest_main.listener_count, 347);
  assert.equal(body.sample_count, 1);
});
