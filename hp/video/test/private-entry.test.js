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
  assert.deepEqual(await response.json(), {
    ok: true,
    service: 'homepanel-video',
    checkedAt: assert.match.string
  });
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
