import assert from 'node:assert/strict';
import test from 'node:test';

import {
  loadMaterializedR2Response,
  pagesActionsR2ResponseKey,
  pagesR2ResponseKey,
} from '../src/pages-response-r2.js';

const NOW = Date.UTC(2026, 6, 31, 3);

function actionsObject(body = { ok: true }, updatedAt = NOW) {
  return {
    body: {},
    async json() {
      return {
        version: 1,
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' },
        updated_at: updatedAt,
        cadence_seconds: 21600,
        body: JSON.stringify(body),
      };
    },
  };
}

function workerObject(body = { ok: true }, updatedAt = NOW) {
  return {
    body: JSON.stringify(body),
    customMetadata: {
      version: '1',
      status: '200',
      headers_json: JSON.stringify({ 'content-type': 'application/json; charset=utf-8' }),
      updated_at: String(updatedAt),
      cadence_seconds: '21600',
    },
  };
}

test('Actions R2 keys use a CLI-safe hexadecimal model identifier', () => {
  assert.equal(
    pagesActionsR2ResponseKey('history:daily'),
    'pages-response/actions-v2/686973746f72793a6461696c79.json',
  );
  for (const modelKey of [
    'dashboard',
    'history:daily',
    'history:weekly',
    'history:monthly',
    'history:broadcasts',
    'host-history:summary',
  ]) {
    const key = pagesActionsR2ResponseKey(modelKey);
    assert.match(key, /^pages-response\/actions-v2\/[0-9a-f]+\.json$/);
    assert.doesNotMatch(key, /[%:]/);
  }
});

test('Actions R2 loader reads only the canonical v2 key', async () => {
  const expected = pagesActionsR2ResponseKey('history:daily');
  const calls = [];
  const response = await loadMaterializedR2Response({
    async get(key) {
      calls.push(key);
      return key === expected ? actionsObject({ source: 'v2' }) : null;
    },
  }, 'history:daily', NOW, 60_000);

  assert.deepEqual(calls, [expected]);
  assert.equal(response.headers.get('x-api-source'), 'actions-r2');
  assert.equal(response.headers.get('x-materialized-at'), String(NOW));
  assert.deepEqual(await response.json(), { source: 'v2' });
});

test('Actions R2 miss and stale responses stop after one R2 get', async () => {
  for (const object of [null, actionsObject({ stale: true }, NOW - 120_000)]) {
    const expected = pagesActionsR2ResponseKey('dashboard');
    const calls = [];
    const response = await loadMaterializedR2Response({
      async get(key) {
        calls.push(key);
        return object;
      },
    }, 'dashboard', NOW, 60_000);

    assert.equal(response, null);
    assert.deepEqual(calls, [expected]);
  }
});

test('track history reads its Worker-owned key directly with one R2 get', async () => {
  const expected = pagesR2ResponseKey('track-history');
  const calls = [];
  const response = await loadMaterializedR2Response({
    async get(key) {
      calls.push(key);
      return key === expected ? workerObject({ source: 'worker' }) : null;
    },
  }, 'track-history', NOW, 60_000);

  assert.deepEqual(calls, [expected]);
  assert.equal(response.headers.get('x-api-source'), 'worker-r2');
  assert.equal(response.headers.get('x-materialized-at'), String(NOW));
  assert.deepEqual(await response.json(), { source: 'worker' });
});
