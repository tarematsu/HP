import assert from 'node:assert/strict';
import test from 'node:test';
import entry, { refreshAmazonModel } from '../scripts/amazon-music-read-model-refresh-entry.js';

test('Amazon readiness probes do not start scans or publish observations', async () => {
  assert.equal((await entry.fetch(new Request('http://localhost/health'), {})).status, 200);
});
test('manual recollection publishes only a complete fresh scan and never relabels old observations', async () => {
  const now = 1000;
  let scans = 0;
  const result = await refreshAmazonModel({ PAGES_RESPONSE_R2: { async get() { return { json: async () => ({ observed_at: now, tracks: [{ group_name: '櫻坂46', amazon_rank: 46 }] }) }; } } }, {
    now, collect: true, dependencies: { async collect() { scans++; return { complete: true, published: { published: true } }; } },
  });
  assert.equal(scans, 1);
  assert.equal(result.published, true);
  assert.equal(result.groups['櫻坂46'], 1);
  await assert.rejects(refreshAmazonModel({}, { now, collect: true, dependencies: { collect: async () => ({ complete: false }) } }), /complete scan/);
});
test('plain model refresh retains its existing collector-free behavior', async () => {
  let scanned = false;
  const result = await refreshAmazonModel({}, { dependencies: {
    collect() { scanned = true; }, publish: async () => ({ published: true }),
  } });
  assert.equal(result.published, true);
  assert.equal(scanned, false);
});
