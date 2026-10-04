import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import test from 'node:test';

import {
  ACTIONS_RAW_MODEL_KEYS,
  loadMaterializedR2Response,
  pagesActionsR2ResponseKey,
  pagesActionsRawMetadataR2ResponseKey,
  pagesActionsRawR2ResponseKey,
} from '../src/pages-response-r2.js';
import { seedRawActionsModel } from '../scripts/seed-pages-actions-raw.mjs';

const NOW = Date.UTC(2026, 9, 5, 0, 30);
const MODEL_KEY = 'spotify-playcounts';

function actionsObject(body, updatedAt = NOW) {
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

function rawObject(body) {
  return {
    body: JSON.stringify(body),
    writeHttpMetadata(headers) {
      headers.set('content-type', 'application/json; charset=utf-8');
    },
  };
}

function metadataObject(sourceEtag, updatedAt = NOW) {
  return {
    body: {},
    async json() {
      return {
        version: 1,
        source_etag: sourceEtag,
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' },
        updated_at: updatedAt,
        cadence_seconds: 21600,
      };
    },
  };
}

test('CPU-sensitive Actions models have raw body and metadata sidecar keys', () => {
  assert.deepEqual(ACTIONS_RAW_MODEL_KEYS, [
    'history:daily',
    'history:weekly',
    'spotify-playcounts',
    'track-history-status',
  ]);
  assert.equal(
    pagesActionsRawR2ResponseKey('history:daily'),
    'pages-response/actions-raw-v1/686973746f72793a6461696c79.json',
  );
  assert.equal(
    pagesActionsRawMetadataR2ResponseKey('history:daily'),
    'pages-response/actions-raw-meta-v1/686973746f72793a6461696c79.json',
  );
});

test('preseeded raw sidecar bypasses canonical Actions envelope parsing', async () => {
  const sourceKey = pagesActionsR2ResponseKey(MODEL_KEY);
  const rawKey = pagesActionsRawR2ResponseKey(MODEL_KEY);
  const metadataKey = pagesActionsRawMetadataR2ResponseKey(MODEL_KEY);
  let canonicalGets = 0;
  let canonicalParses = 0;
  const canonical = actionsObject({ source: 'canonical' });
  const originalJson = canonical.json.bind(canonical);
  canonical.json = async () => {
    canonicalParses += 1;
    return originalJson();
  };

  const response = await loadMaterializedR2Response({
    async head(key) {
      return key === sourceKey ? { etag: 'etag-current' } : null;
    },
    async get(key) {
      if (key === rawKey) return rawObject({ source: 'raw' });
      if (key === metadataKey) return metadataObject('etag-current');
      if (key === sourceKey) {
        canonicalGets += 1;
        return canonical;
      }
      return null;
    },
  }, MODEL_KEY, NOW, Number.MAX_SAFE_INTEGER);

  assert.equal(response.headers.get('x-api-source'), 'actions-r2-raw');
  assert.deepEqual(await response.json(), { source: 'raw' });
  assert.equal(canonicalGets, 0);
  assert.equal(canonicalParses, 0);
});

test('raw sidecar ETag mismatch falls back to canonical envelope', async () => {
  const sourceKey = pagesActionsR2ResponseKey(MODEL_KEY);
  const rawKey = pagesActionsRawR2ResponseKey(MODEL_KEY);
  const metadataKey = pagesActionsRawMetadataR2ResponseKey(MODEL_KEY);
  let canonicalParses = 0;
  const canonical = actionsObject({ source: 'canonical' });
  const originalJson = canonical.json.bind(canonical);
  canonical.json = async () => {
    canonicalParses += 1;
    return originalJson();
  };

  const response = await loadMaterializedR2Response({
    async head(key) {
      return key === sourceKey ? { etag: 'etag-current' } : null;
    },
    async get(key) {
      if (key === rawKey) return rawObject({ source: 'stale-raw' });
      if (key === metadataKey) return metadataObject('etag-old');
      if (key === sourceKey) return canonical;
      return null;
    },
  }, MODEL_KEY, NOW, Number.MAX_SAFE_INTEGER);

  assert.equal(response.headers.get('x-api-source'), 'actions-r2');
  assert.deepEqual(await response.json(), { source: 'canonical' });
  assert.equal(canonicalParses, 1);
});

test('Actions raw seeder writes a raw body and small ETag metadata object', () => {
  const body = JSON.stringify({ ok: true, rows: Array.from({ length: 20 }, (_, index) => index) });
  const envelope = {
    version: 1,
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    updated_at: NOW,
    cadence_seconds: 21600,
    body,
  };
  const envelopeText = JSON.stringify(envelope);
  const expectedEtag = createHash('md5').update(envelopeText).digest('hex');
  const written = new Map();

  const result = seedRawActionsModel(MODEL_KEY, {
    getObject(key, path) {
      assert.equal(key, pagesActionsR2ResponseKey(MODEL_KEY));
      writeFileSync(path, envelopeText, 'utf8');
    },
    putObject(key, path, contentType) {
      written.set(key, { content: readFileSync(path, 'utf8'), contentType });
    },
  });

  const raw = written.get(pagesActionsRawR2ResponseKey(MODEL_KEY));
  const metadata = written.get(pagesActionsRawMetadataR2ResponseKey(MODEL_KEY));
  assert.equal(raw.content, body);
  assert.equal(raw.contentType, 'application/json; charset=utf-8');
  const parsedMetadata = JSON.parse(metadata.content);
  assert.equal(parsedMetadata.source_etag, expectedEtag);
  assert.equal(parsedMetadata.updated_at, NOW);
  assert.equal(parsedMetadata.status, 200);
  assert.equal(result.source_etag, expectedEtag);
});
