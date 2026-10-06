import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  loadMaterializedR2Response,
  pagesR2ResponseKey,
} from '../src/pages-response-r2.js';
import { loadMaterializedResponse } from '../src/pages-response-store.js';

const NOW = Date.UTC(2026, 6, 31, 3);

function canonicalObject(body = { ok: true }, updatedAt = NOW) {
  return {
    body: JSON.stringify(body),
    customMetadata: {
      version: '1',
      format: 'raw-response-v1',
      status: '200',
      headers_json: JSON.stringify({ 'content-type': 'application/json; charset=utf-8' }),
      updated_at: String(updatedAt),
      cadence_seconds: '21600',
    },
  };
}

function legacyActionsObject(body = { ok: true }, updatedAt = NOW) {
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

test('canonical Pages R2 keys use one pages-response/v1 object per model', () => {
  assert.equal(
    pagesR2ResponseKey('history:daily'),
    'pages-response/v1/history%3Adaily.json',
  );
  for (const modelKey of ['dashboard', 'history:daily', 'followers', 'track-history-status']) {
    assert.match(pagesR2ResponseKey(modelKey), /^pages-response\/v1\/.+\.json$/);
  }
});

test('canonical R2 loader reads only the v1 key', async () => {
  const expected = pagesR2ResponseKey('history:daily');
  const calls = [];
  const response = await loadMaterializedR2Response({
    async get(key) {
      calls.push(key);
      return key === expected ? canonicalObject({ source: 'canonical' }) : null;
    },
  }, 'history:daily', NOW, 60_000);

  assert.deepEqual(calls, [expected]);
  assert.equal(response.headers.get('x-api-source'), 'worker-r2');
  assert.equal(response.headers.get('x-materialized-at'), String(NOW));
  assert.deepEqual(await response.json(), { source: 'canonical' });
});

test('migration reader probes actions-v2 only after a canonical miss', async () => {
  const canonicalKey = pagesR2ResponseKey('history:daily');
  const legacyKey = 'pages-response/actions-v2/686973746f72793a6461696c79.json';
  const calls = [];
  const response = await loadMaterializedResponse({
    async get(key) {
      calls.push(key);
      return key === legacyKey ? legacyActionsObject({ source: 'legacy' }) : null;
    },
  }, 'history:daily', NOW, 60_000);

  assert.deepEqual(calls, [canonicalKey, legacyKey]);
  assert.equal(response.headers.get('x-api-source'), 'legacy-actions-r2');
  assert.deepEqual(await response.json(), { source: 'legacy' });
});

test('migration reader never probes actions-v2 when canonical data exists', async () => {
  const canonicalKey = pagesR2ResponseKey('followers');
  const calls = [];
  const response = await loadMaterializedResponse({
    async get(key) {
      calls.push(key);
      return key === canonicalKey ? canonicalObject({ source: 'canonical' }) : null;
    },
  }, 'followers', NOW, Number.MAX_SAFE_INTEGER);

  assert.deepEqual(calls, [canonicalKey]);
  assert.deepEqual(await response.json(), { source: 'canonical' });
});

test('actions-v2 compatibility is isolated to pages-response-store', () => {
  const canonicalSource = readFileSync(new URL('../src/pages-response-r2.js', import.meta.url), 'utf8');
  const migrationSource = readFileSync(new URL('../src/pages-response-store.js', import.meta.url), 'utf8');
  assert.doesNotMatch(canonicalSource, /actions-v2|pagesActionsR2ResponseKey|saveMaterializedActionsR2Response/);
  assert.match(migrationSource, /pages-response\/actions-v2/);
  assert.match(migrationSource, /loadLegacyActionsR2Response/);
});
