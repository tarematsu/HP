import assert from 'node:assert/strict';
import test from 'node:test';
import { refreshAmazonModel } from '../scripts/refresh-amazon-music-actions.mjs';
test('manual recollection publishes only a complete fresh scan and never relabels old observations', async () => {
  const now = 1000;
  let scans = 0;
  const result = await refreshAmazonModel({ PAGES_RESPONSE_R2: { async get() { return { json: async () => ({ observed_at: now, tracks: [{ group_name: '櫻坂46', amazon_rank: 46 }] }) }; } } }, {
    now, dependencies: { async collect() { scans++; return { complete: true, published: { published: true } }; } },
  });
  assert.equal(scans, 1);
  assert.equal(result.published, true);
  assert.equal(result.groups['櫻坂46'], 1);
  await assert.rejects(refreshAmazonModel({}, { now, dependencies: { collect: async () => ({ complete: false }) } }), /complete scan/);
});

test('a successful incomplete batch continues before the fresh model is checked', async () => {
  let continued = 0;
  const now = 1000;
  const result = await refreshAmazonModel({ PAGES_RESPONSE_R2: {
    get: async () => ({ json: async () => ({ observed_at: now, tracks: [] }) }),
  } }, { now, dependencies: {
    collect: async () => ({ ok: true, skipped: false, complete: false, scanned_tracks: 49_950 }),
    continue: async (_env, observedAt) => {
      assert.equal(observedAt, now);
      continued++;
      return { complete: true, published: { published: true } };
    },
  } });
  assert.equal(result.published, true);
  assert.equal(continued, 1);
});

test('recovery preserves collection failure details', async () => {
  await assert.rejects(refreshAmazonModel({}, {}), /PAGES_RESPONSE_R2 binding is required/);
});
