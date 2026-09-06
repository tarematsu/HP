import assert from 'node:assert/strict';
import test from 'node:test';

import sakurazakaWorker, { sakurazakaHealth } from '../src/sakurazaka-entry.js';

function healthDatabase({ raw = null, derived = null, news = null, fail = '' } = {}) {
  return {
    prepare(sql) {
      const component = sql.includes('sh_sakurazaka46jp_main')
        ? 'raw_collection'
        : sql.includes('sh_host_broadcast_sessions')
          ? 'raw_materializer'
          : 'official_news';
      let bindings = [];
      const statement = {
        bind(...values) {
          bindings = values;
          return statement;
        },
        async first() {
          if (fail === component) throw new Error(`${component} database unavailable`);
          if (component === 'raw_materializer') {
            assert.deepEqual(bindings, ['custom-handle']);
            return derived;
          }
          if (component === 'raw_collection') return raw;
          return news;
        },
      };
      return statement;
    },
  };
}

test('Sakurazaka health reports raw collection, raw materializer, and official news state', async () => {
  const response = await sakurazakaWorker.fetch(new Request('https://worker.example/health'), {
    SOLO_BROADCAST_HANDLE: 'custom-handle',
    OTHER_DB: healthDatabase({
      raw: { observed_at: 10, station_id: 777, is_broadcasting: 1 },
      derived: { id: 7, status: 'active', station_id: 777, last_observed_at: 10 },
      news: { last_check_at: 20, last_success_at: 20 },
    }),
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(body.ok, true);
  assert.deepEqual(body.raw_collection, { observed_at: 10, station_id: 777, is_broadcasting: 1 });
  assert.deepEqual(body.raw_materializer, { id: 7, status: 'active', station_id: 777, last_observed_at: 10 });
  assert.deepEqual(body.official_news, { last_check_at: 20, last_success_at: 20 });
  assert.equal(body.degraded_components, undefined);
});

test('Sakurazaka health preserves raw-derived partial state and returns 503 on one D1 failure', async () => {
  const originalError = console.error;
  console.error = () => {};
  try {
    const response = await sakurazakaHealth({
      SOLO_BROADCAST_HANDLE: 'custom-handle',
      OTHER_DB: healthDatabase({
        raw: { observed_at: 30, station_id: 777, is_broadcasting: 0 },
        derived: { id: 7, status: 'ended', station_id: 777, last_observed_at: 30 },
        fail: 'official_news',
      }),
    });
    const body = await response.json();

    assert.equal(response.status, 503);
    assert.equal(body.ok, false);
    assert.deepEqual(body.raw_collection, { observed_at: 30, station_id: 777, is_broadcasting: 0 });
    assert.deepEqual(body.raw_materializer, { id: 7, status: 'ended', station_id: 777, last_observed_at: 30 });
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
    assert.equal(body.raw_collection, null);
    assert.equal(body.raw_materializer, null);
    assert.equal(body.official_news, null);
    assert.deepEqual(body.degraded_components, ['raw_collection', 'raw_materializer', 'official_news']);
  } finally {
    console.error = originalError;
  }
});
