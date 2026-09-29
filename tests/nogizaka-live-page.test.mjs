import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { onRequestGet } from '../site/functions/api/nogizaka46smej-status.js';

const html = readFileSync(new URL('../site/public/nogizaka46smej/index.html', import.meta.url), 'utf8');
const client = readFileSync(new URL('../site/public/nogizaka46smej/live.js', import.meta.url), 'utf8');
const api = readFileSync(new URL('../site/functions/api/nogizaka46smej-status.js', import.meta.url), 'utf8');

function fakeDb({ event = null, samples = [] } = {}) {
  return {
    prepare(sql) {
      return {
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

test('Nogizaka realtime page is addressable as a dedicated static route', () => {
  assert.match(html, /nogizaka46smej/);
  assert.match(html, /リアルタイム数値/);
  assert.match(html, /\/nogizaka46smej\/live\.js/);
  assert.match(client, /\/api\/nogizaka46smej-status/);
  assert.match(client, /collection_active \? 15000 : 60000/);
});

test('Nogizaka realtime API reads only isolated Nogizaka collection tables', () => {
  assert.match(api, /sh_nogizaka_official_news_announcements/);
  assert.match(api, /sh_nogizaka46smej_main/);
  assert.doesNotMatch(api, /sh_sakurazaka46jp_main|sh_official_news_announcements\b/);
  assert.match(api, /listener_count/);
  assert.match(api, /total_listens/);
  assert.match(api, /followers/);
});

test('active Nogizaka collection returns realtime samples with a short refresh hint', async () => {
  const observedAt = Date.now() - 5_000;
  const response = await onRequestGet({
    env: {
      OTHER_DB: fakeDb({
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
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.handle, 'nogizaka46smej');
  assert.equal(body.collection_active, true);
  assert.equal(body.refresh_hint_ms, 15000);
  assert.equal(body.latest.listener_count, 347);
  assert.equal(body.sample_count, 1);
});
