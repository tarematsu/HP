import assert from 'node:assert/strict';
import test from 'node:test';
import { migrateKkboxRawResponse } from '../scripts/migrate-kkbox-raw-response-actions.mjs';
import { loadMaterializedR2Response, pagesR2ResponseKey } from '../src/pages-response-r2.js';

function bucket() {
  const values = new Map();
  let parsedRaw = false;
  return {
    values, get parsedRaw() { return parsedRaw; },
    async put(key, body) { values.set(key, String(body)); },
    async get(key) {
      if (!values.has(key)) return null;
      const text = values.get(key);
      return { body: new Response(text).body, text: async () => text,
        json: async () => {
          if (key.includes('/raw-body-v1/')) { parsedRaw = true; throw new Error('HTTP must stream raw body'); }
          return JSON.parse(text);
        } };
    },
  };
}

test('migration preserves payload and freshness while HTTP streams the raw body', async () => {
  const r2 = bucket();
  const legacyKey = `pages-response/actions-v2/${Buffer.from('music-service:kkbox').toString('hex')}.json`;
  const body = JSON.stringify({ ok: true, tracks: Array.from({ length: 1000 }, (_, id) => ({ id })) });
  const envelope = { version: 1, status: 200, headers: { 'content-type': 'application/json' },
    updated_at: 1000, cadence_seconds: 86400, body };
  await r2.put(legacyKey, JSON.stringify(envelope));
  assert.equal((await migrateKkboxRawResponse(r2)).migrated, true);
  const response = await loadMaterializedR2Response(r2, 'music-service:kkbox', 2000, 2000);
  assert.equal(await response.text(), body);
  assert.equal(response.headers.get('x-materialized-at'), '1000');
  assert.equal(response.headers.get('x-materialized-cadence-seconds'), '86400');
  assert.equal(response.headers.get('x-api-source'), 'worker-r2');
  assert.equal(r2.parsedRaw, false);
  assert.equal(await loadMaterializedR2Response(r2, 'music-service:kkbox', 10000, 100), null);
  assert.ok(r2.values.has(legacyKey));
  assert.deepEqual(await migrateKkboxRawResponse(r2), { migrated: false, reason: 'canonical-exists' });
});

test('reference reader rejects missing bodies and foreign object paths', async () => {
  const r2 = bucket();
  const key = pagesR2ResponseKey('music-service:kkbox');
  for (const body_key of ['private/data.json', `pages-response/raw-body-v1/${'a'.repeat(64)}.json`]) {
    await r2.put(key, JSON.stringify({ format: 'raw-response-reference-v1', version: 1,
      updated_at: 1000, body_key }));
    assert.equal(await loadMaterializedR2Response(r2, 'music-service:kkbox', 2000), null);
  }
});
