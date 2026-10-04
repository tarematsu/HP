import assert from 'node:assert/strict';
import test from 'node:test';

import {
  loadMaterializedR2Response,
  pagesActionsR2ResponseKey,
  pagesActionsRawR2ResponseKey,
} from '../src/pages-response-r2.js';

const NOW = Date.UTC(2026, 9, 4, 14, 0, 0);
const MODEL_KEY = 'history:daily';

function sourceObject(etag, payload, updatedAt = NOW) {
  return {
    body: {},
    etag,
    async json() {
      return {
        version: 1,
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' },
        updated_at: updatedAt,
        cadence_seconds: 86400,
        body: JSON.stringify(payload),
      };
    },
  };
}

function rawObject(body, metadata) {
  return {
    body,
    customMetadata: metadata,
    writeHttpMetadata(headers) {
      headers.set('content-type', 'application/json; charset=utf-8');
    },
  };
}

test('daily Actions read model has a separate CLI-safe raw streaming key', () => {
  assert.equal(
    pagesActionsRawR2ResponseKey(MODEL_KEY),
    'pages-response/actions-raw-v1/686973746f72793a6461696c79.json',
  );
});

test('daily Actions read model parses the envelope once, seeds raw R2, then streams raw body', async () => {
  const sourceKey = pagesActionsR2ResponseKey(MODEL_KEY);
  const rawKey = pagesActionsRawR2ResponseKey(MODEL_KEY);
  let raw = null;
  let envelopeParses = 0;
  let sourceGets = 0;
  let rawWrites = 0;
  const source = sourceObject('etag-1', { ok: true, rows: [1, 2, 3] });
  const originalJson = source.json.bind(source);
  source.json = async () => {
    envelopeParses += 1;
    return originalJson();
  };

  const r2 = {
    async head(key) {
      return key === sourceKey ? { etag: source.etag } : null;
    },
    async get(key) {
      if (key === sourceKey) {
        sourceGets += 1;
        return source;
      }
      if (key === rawKey) return raw;
      return null;
    },
    async put(key, body, options) {
      assert.equal(key, rawKey);
      rawWrites += 1;
      raw = rawObject(body, options.customMetadata);
    },
  };

  const first = await loadMaterializedR2Response(r2, MODEL_KEY, NOW, Number.MAX_SAFE_INTEGER);
  assert.equal(first.headers.get('x-api-source'), 'actions-r2');
  assert.deepEqual(await first.json(), { ok: true, rows: [1, 2, 3] });
  assert.equal(envelopeParses, 1);
  assert.equal(sourceGets, 1);
  assert.equal(rawWrites, 1);

  const second = await loadMaterializedR2Response(r2, MODEL_KEY, NOW + 60_000, Number.MAX_SAFE_INTEGER);
  assert.equal(second.headers.get('x-api-source'), 'actions-r2-raw');
  assert.deepEqual(await second.json(), { ok: true, rows: [1, 2, 3] });
  assert.equal(envelopeParses, 1);
  assert.equal(sourceGets, 1);
  assert.equal(rawWrites, 1);
});

test('daily raw body is invalidated when the canonical envelope ETag changes', async () => {
  const sourceKey = pagesActionsR2ResponseKey(MODEL_KEY);
  const rawKey = pagesActionsRawR2ResponseKey(MODEL_KEY);
  let source = sourceObject('etag-2', { revision: 2 }, NOW + 10_000);
  let parses = 0;
  const originalJson = source.json.bind(source);
  source.json = async () => {
    parses += 1;
    return originalJson();
  };
  let raw = rawObject(JSON.stringify({ revision: 1 }), {
    version: '1',
    source_etag: 'etag-1',
    status: '200',
    headers_json: JSON.stringify({ 'content-type': 'application/json; charset=utf-8' }),
    updated_at: String(NOW),
    cadence_seconds: '86400',
  });

  const response = await loadMaterializedR2Response({
    async head(key) { return key === sourceKey ? { etag: source.etag } : null; },
    async get(key) {
      if (key === sourceKey) return source;
      if (key === rawKey) return raw;
      return null;
    },
    async put(key, body, options) {
      assert.equal(key, rawKey);
      raw = rawObject(body, options.customMetadata);
    },
  }, MODEL_KEY, NOW + 10_000, Number.MAX_SAFE_INTEGER);

  assert.equal(response.headers.get('x-api-source'), 'actions-r2');
  assert.deepEqual(await response.json(), { revision: 2 });
  assert.equal(parses, 1);
  assert.equal(raw.customMetadata.source_etag, 'etag-2');
});
