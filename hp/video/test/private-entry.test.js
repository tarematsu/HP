import assert from 'node:assert/strict';
import test from 'node:test';

import worker from '../src/entry.js';

function healthyDb() {
  return {
    prepare(sql) {
      assert.equal(sql, 'SELECT 1 AS ok');
      return { async first() { return { ok: 1 }; } };
    }
  };
}

test('private video health checks D1 without the gateway marker', async () => {
  const response = await worker.fetch(
    new Request('https://video.internal/api/health'),
    { DB: healthyDb() },
    {}
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.service, 'homepanel-video');
  assert.equal(typeof body.checkedAt, 'string');
});

test('private video worker rejects direct traffic', async () => {
  const response = await worker.fetch(
    new Request('https://video.internal/api/status'),
    { DB: healthyDb() },
    {}
  );
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { ok: false, error: 'Not found' });
});

test('gateway-marked requests reach the video runtime', async () => {
  const response = await worker.fetch(
    new Request('https://video.internal/unknown', {
      headers: { 'X-HomePanel-Internal-Service': 'homepanel-cloud' }
    }),
    { DB: healthyDb() },
    {}
  );
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { ok: false, error: 'Not found' });
});

test('hourly Cron delegates liveness work to the Durable Object', async () => {
  const calls = [];
  const pending = [];
  worker.scheduled(
    { cron: '0 * * * *' },
    {
      SCHEDULER_COORDINATOR: {
        getByName(name) {
          assert.equal(name, 'video-liveness');
          return {
            async fetch(url, init) {
              calls.push({ url, init });
              return Response.json({ ok: true, checkedCount: 5 });
            }
          };
        }
      }
    },
    { waitUntil(task) { pending.push(task); } }
  );

  assert.equal(pending.length, 1);
  await pending[0];
  assert.deepEqual(calls, [{
    url: 'https://homepanel.internal/video-liveness-run',
    init: { method: 'POST' }
  }]);
});
