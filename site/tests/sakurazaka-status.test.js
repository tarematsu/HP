import assert from 'node:assert/strict';
import test from 'node:test';

import { onRequestGet } from '../functions/api/sakurazaka46jp-status.js';

const NOW = 1_700_000_000_000;

function db() {
  return {
    prepare(sql) {
      return {
        async all() {
          if (sql.includes('FROM sh_sakurazaka46jp_main')) {
            return {
              results: [{
                observed_at: NOW - 60_000,
                observed_minute: Math.floor((NOW - 60_000) / 60_000),
                station_id: 777,
                broadcast_id: 888,
                broadcast_start_time: NOW - 600_000,
                is_broadcasting: 1,
                listener_count: 1234,
                guest_count: 5,
                total_listens: 6789,
                status: 'live',
                chat_status: 'connected',
                channel_id: 42,
                channel_alias: 'sakurazaka46jp',
                raw_valid: 1,
                raw_bytes: 4096,
              }],
            };
          }
          if (sql.includes('FROM sh_sakurazaka46jp_chat')) {
            return {
              results: [{
                observed_at: NOW - 55_000,
                observed_minute: Math.floor((NOW - 55_000) / 60_000),
                station_id: 777,
                raw_valid: 1,
                raw_bytes: 1024,
              }],
            };
          }
          throw new Error(`unexpected SQL: ${sql}`);
        },
      };
    },
  };
}

test('Sakurazaka status exposes latest per-minute main and chat samples without caching', async () => {
  const realDateNow = Date.now;
  Date.now = () => NOW;
  try {
    const response = await onRequestGet({ env: { OTHER_DB: db() } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.handle, 'sakurazaka46jp');
    assert.equal(payload.sample_count, 1);
    assert.equal(payload.chat_sample_count, 1);
    assert.equal(payload.latest_main.station_id, 777);
    assert.equal(payload.latest_main.listener_count, 1234);
    assert.equal(payload.latest_main_age_ms, 60_000);
    assert.equal(payload.latest_chat_age_ms, 55_000);
    assert.equal(payload.recent_limit, 180);
  } finally {
    Date.now = realDateNow;
  }
});

test('Sakurazaka status returns 503 when OTHER_DB is unavailable', async () => {
  const response = await onRequestGet({ env: {} });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).ok, false);
});
