import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import test from 'node:test';

import {
  loadMaterializedR2Response,
  pagesActionsR2ResponseKey,
  pagesActionsRawMetadataR2ResponseKey,
  pagesActionsRawR2ResponseKey,
} from '../src/pages-response-r2.js';
import {
  rawMetadataForEnvelope,
  seedRawActionsModel,
} from '../scripts/seed-pages-actions-raw.mjs';

const NOW = Date.UTC(2026, 9, 5, 0, 0, 0);

function envelopeFor(payload) {
  return {
    version: 1,
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'x-test-header': 'kept',
    },
    updated_at: NOW,
    cadence_seconds: 86400,
    body: JSON.stringify(payload),
  };
}

function rawObject(body, metadata = {}) {
  return {
    body,
    customMetadata: metadata,
    writeHttpMetadata(headers) {
      headers.set('content-type', 'application/json; charset=utf-8');
    },
  };
}

function metadataObject(metadata) {
  return {
    body: {},
    async json() {
      return metadata;
    },
  };
}

for (const modelKey of ['history:weekly', 'track-history-status']) {
  test(`${modelKey} serves a preseeded raw companion without reading the canonical body`, async () => {
    const envelope = envelopeFor({ ok: true, model: modelKey, rows: [1, 2, 3] });
    const envelopeText = JSON.stringify(envelope);
    const etag = createHash('md5').update(envelopeText).digest('hex');
    const sourceKey = pagesActionsR2ResponseKey(modelKey);
    const rawKey = pagesActionsRawR2ResponseKey(modelKey);
    const metadataKey = pagesActionsRawMetadataR2ResponseKey(modelKey);
    let sourceGets = 0;
    let rawWrites = 0;

    const response = await loadMaterializedR2Response({
      async head(key) {
        return key === sourceKey ? { etag } : null;
      },
      async get(key) {
        if (key === sourceKey) {
          sourceGets += 1;
          throw new Error('canonical body should not be read');
        }
        if (key === rawKey) return rawObject(envelope.body);
        if (key === metadataKey) return metadataObject(rawMetadataForEnvelope(envelope, etag));
        return null;
      },
      async put() {
        rawWrites += 1;
      },
    }, modelKey, NOW + 1_000, Number.MAX_SAFE_INTEGER);

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-api-source'), 'actions-r2-raw');
    assert.equal(response.headers.get('x-test-header'), 'kept');
    assert.deepEqual(await response.json(), { ok: true, model: modelKey, rows: [1, 2, 3] });
    assert.equal(sourceGets, 0);
    assert.equal(rawWrites, 0);
  });
}

test('Actions raw seeder writes body and canonical-ETag metadata as separate R2 objects', () => {
  const modelKey = 'history:daily';
  const envelope = envelopeFor({ ok: true, rows: [{ day: '2026-10-04' }] });
  const envelopeText = JSON.stringify(envelope);
  const expectedEtag = createHash('md5').update(envelopeText).digest('hex');
  const writes = [];

  const result = seedRawActionsModel(modelKey, {
    getObject(key, path) {
      assert.equal(key, pagesActionsR2ResponseKey(modelKey));
      writeFileSync(path, envelopeText, 'utf8');
    },
    putObject(key, path) {
      writes.push({ key, body: readFileSync(path, 'utf8') });
    },
  });

  assert.equal(result.source_etag, expectedEtag);
  assert.equal(result.metadata_key, pagesActionsRawMetadataR2ResponseKey(modelKey));
  assert.deepEqual(writes.map((entry) => entry.key), [
    pagesActionsRawR2ResponseKey(modelKey),
    pagesActionsRawMetadataR2ResponseKey(modelKey),
  ]);
  assert.equal(writes[0].body, envelope.body);
  const metadata = JSON.parse(writes[1].body);
  assert.equal(metadata.source_etag, expectedEtag);
  assert.deepEqual(JSON.parse(decodeURIComponent(metadata.headers_uri)), envelope.headers);
});
