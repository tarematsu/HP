import assert from 'node:assert/strict';
import test from 'node:test';

import {
  OHISAMA_FOLLOWER_TARGET_CACHE_KEY,
  cachedOhisamaFollowerMetadataRegistrar,
} from '../src/ohisama-follower-target-cache.js';

class FakeR2 {
  constructor(value = null) {
    this.value = value;
    this.puts = 0;
  }
  async get() {
    if (!this.value) return null;
    return { json: async () => JSON.parse(this.value) };
  }
  async put(_key, value) {
    this.puts += 1;
    this.value = String(value);
  }
}

test('Ohisama R2 cache suppresses metadata work but not registry work outside the wrapper', async () => {
  const r2 = new FakeR2(JSON.stringify({ version: 3, handles: ['host-a'] }));
  let metadataCalls = 0;
  const cachedMetadata = cachedOhisamaFollowerMetadataRegistrar(async () => {
    metadataCalls += 1;
    return true;
  });

  assert.equal(await cachedMetadata({ PAGES_RESPONSE_R2: r2 }, { host_handle: 'host-a' }, 1000), false);
  assert.equal(metadataCalls, 0);
  assert.equal(r2.puts, 0);
  assert.equal(OHISAMA_FOLLOWER_TARGET_CACHE_KEY, 'stationhead/ohisama/follower-targets.json');
});
