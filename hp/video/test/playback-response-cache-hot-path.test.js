import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../src/entry-core.js', import.meta.url), 'utf8');

test('playback response cache evicts by size without full-map expiry sweeps', () => {
  assert.match(source, /function trimPlaybackCache\(cache\)/);
  assert.match(source, /while \(cache\.size > PLAYBACK_CACHE_LIMIT\)/);
  assert.match(source, /trimPlaybackCache\(cache\);/);
  assert.doesNotMatch(source, /for \(const \[key, entry\] of cache\)/);
  assert.doesNotMatch(source, /trimPlaybackCache\(cache, Date\.now\(\)\)/);
});
