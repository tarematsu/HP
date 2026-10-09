import assert from 'node:assert/strict';
import test from 'node:test';
import { saveMaterializedR2Response, loadMaterializedR2Response } from '../src/pages-response-r2.js';
import { normalizeFollowersResponse } from '../src/stationhead-followers-response.js';

test('published followers are sanitized once and served without consuming their stream', async () => {
  let stored;
  const r2 = {
    async put(key, body, options) { stored = { key, body, ...options }; },
    async get() { return stored; },
  };
  await saveMaterializedR2Response(r2, 'followers', JSON.stringify({
    handles: ['sakuramankai', 'buddy46'],
    rows: [{ date: '2026-10-09', sakuramankai: 10, buddy46: 20 }],
  }), 200, { 'content-type': 'application/json' }, 1000, 3600);
  const response = await loadMaterializedR2Response(r2, 'followers', 1000);
  assert.equal(await normalizeFollowersResponse(response), response);
  assert.equal(response.bodyUsed, false);
  const body = await response.json();
  assert.ok(!body.handles.includes('buddy46'));
  assert.equal(body.rows[0].buddy46, undefined);
  assert.equal(body.rows[0].sakuramankai, 10);
});

test('unmarked legacy followers still receive normalization', async () => {
  const response = await normalizeFollowersResponse(new Response(JSON.stringify({ handles: ['buddy46', 'sakuramankai'] })));
  assert.deepEqual((await response.json()).handles, ['sakuramankai']);
});
