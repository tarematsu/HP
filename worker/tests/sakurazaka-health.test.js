import assert from 'node:assert/strict';
import test from 'node:test';

import sakurazakaWorker, { sakurazakaHealth } from '../src/sakurazaka-entry.js';

function healthDatabase({ monitor = null, news = null, fail = '' } = {}) {
  return {
    prepare(sql) {
      const component = sql.includes('sh_cloud_host_monitor_state') ? 'monitor' : 'official_news';
      let bindings = [];
      const statement = {
        bind(...values) {
          bindings = values;
          return statement;
        },
        async first() {
          if (fail === component) throw new Error(`${component} database unavailable`);
          if (component === 'monitor') {
            assert.deepEqual(bindings, ['solo:custom-handle']);
            return monitor;
          }
          return news;
        },
      };
      return statement;
    },
  };
}

test('Sakurazaka health reports both successful D1 components', async () => {
  const response = await sakurazakaWorker.fetch(new Request('https://worker.example/health'), {
    SOLO_BROADCAST_HANDLE: 'custom-handle',
    OTHER_DB: healthDatabase({
      monitor: { phase: 'live', last_success_at: 10 },
      news: { last_check_at: 20, last_success_at: 20 },
    }),
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(body.ok, true);
  assert.deepEqual(body.monitor, { phase: 'live', last_success_at: 10 });
  assert.deepEqual(body.official_news, { last_check_at: 20, last_success_at: 20 });
  assert.equal(body.degraded_components, undefined);
});

test('Sakurazaka health preserves partial state and returns 503 on one D1 failure', async () => {
  const originalError = console.error;
  console.error = () => {};
  try {
    const response = await sakurazakaHealth({
      SOLO_BROADCAST_HANDLE: 'custom-handle',
      OTHER_DB: healthDatabase({
        monitor: { phase: 'idle', last_success_at: 30 },
        fail: 'official_news',
      }),
    });
    const body = await response.json();

    assert.equal(response.status, 503);
    assert.equal(body.ok, false);
    assert.deepEqual(body.monitor, { phase: 'idle', last_success_at: 30 });
    assert.equal(body.official_news, null);
    assert.deepEqual(body.degraded_components, ['official_news']);
  } finally {
    console.error = originalError;
  }
});

test('Sakurazaka health fails closed when OTHER_DB is missing', async () => {
  const originalError = console.error;
  console.error = () => {};
  try {
    const response = await sakurazakaHealth({ SOLO_BROADCAST_HANDLE: 'custom-handle' });
    const body = await response.json();

    assert.equal(response.status, 503);
    assert.equal(body.ok, false);
    assert.equal(body.monitor, null);
    assert.equal(body.official_news, null);
    assert.deepEqual(body.degraded_components, ['monitor', 'official_news']);
  } finally {
    console.error = originalError;
  }
});