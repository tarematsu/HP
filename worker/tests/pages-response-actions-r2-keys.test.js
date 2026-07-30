import assert from 'node:assert/strict';
import test from 'node:test';

import {
  legacyPagesActionsR2ResponseKeys,
  loadMaterializedR2Response,
  pagesActionsR2ResponseKey,
} from '../src/pages-response-r2.js';

const NOW = Date.UTC(2026, 6, 31, 3);

function actionsObject(body = { ok: true }) {
  return {
    body: {},
    async json() {
      return {
        version: 1,
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' },
        updated_at: NOW,
        cadence_seconds: 21600,
        body: JSON.stringify(body),
      };
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

test('Actions R2 loader reads the canonical v2 key first', async () => {
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

test('Actions R2 loader recovers both legacy encoded and CLI-decoded keys', async () => {
  const [encoded, decoded] = legacyPagesActionsR2ResponseKeys('history:daily');
  assert.equal(encoded, 'pages-response/actions-v1/history%3Adaily.json');
  assert.equal(decoded, 'pages-response/actions-v1/history:daily.json');

  for (const available of [encoded, decoded]) {
    const calls = [];
    const response = await loadMaterializedR2Response({
      async get(key) {
        calls.push(key);
        return key === available ? actionsObject({ available }) : null;
      },
    }, 'history:daily', NOW, 60_000);

    assert.equal(response.headers.get('x-api-source'), 'actions-r2');
    assert.deepEqual(await response.json(), { available });
    assert.ok(calls.includes(available));
    assert.equal(calls[0], pagesActionsR2ResponseKey('history:daily'));
  }
});
