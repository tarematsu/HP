import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const fastStore = readFileSync(new URL('../src/minute-facts-fast-store.js', import.meta.url), 'utf8');
const compatibilitySource = readFileSync(new URL('../src/buddies-facts-sync.js', import.meta.url), 'utf8');

test('minute enrichment handoff does not copy Apple Music IDs', () => {
  const compactQueue = fastStore.slice(
    fastStore.indexOf('function compactPlaybackQueue'),
    fastStore.indexOf('async function enqueueMinuteEnrichment'),
  );
  assert.doesNotMatch(compactQueue, /apple[_-]?music/i);
  assert.match(compactQueue, /spotify_id/);
  assert.match(compactQueue, /isrc/);
});

test('removed buddies facts sync path is a SQL-free compatibility export', () => {
  assert.match(compatibilitySource, /synchronization system has been removed/);
  assert.match(compatibilitySource, /repairPlaybackReadModels/);
  assert.doesNotMatch(compatibilitySource, /INSERT|UPDATE|SELECT|DELETE/i);
  assert.doesNotMatch(compatibilitySource, /apple[_-]?music/i);
});
