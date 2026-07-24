import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const collection = await readFile(new URL('../src/collection-exclusions.js', import.meta.url), 'utf8');
const blocklist = await readFile(new URL('../src/video-blocklist.js', import.meta.url), 'utf8');
const deathList = await readFile(new URL('../src/video-death-list.js', import.meta.url), 'utf8');

test('collection exclusion filtering starts directly with D1 payload queries', () => {
  assert.doesNotMatch(collection, /ensureDbIndexes/);
  assert.doesNotMatch(collection, /ensurePlaybackExclusionTable/);
  assert.doesNotMatch(collection, /ensureVideoDeathListTable/);
  assert.doesNotMatch(collection, /Promise\.all/);
  assert.match(collection, /const stateStatements = orientationPayloads\(items\)/);
});

test('blocklist and death-list guards remain synchronous compatibility no-ops', () => {
  assert.match(blocklist, /export function ensurePlaybackExclusionTable\(\) \{\s+return undefined;/);
  assert.match(deathList, /export function ensureVideoDeathListTable\(\) \{\s+return undefined;/);
  assert.doesNotMatch(blocklist, /ensureDatabaseOnce/);
  assert.doesNotMatch(deathList, /ensureDatabaseOnce/);
  assert.doesNotMatch(blocklist, /CREATE TABLE IF NOT EXISTS video_blocklist/);
  assert.doesNotMatch(deathList, /CREATE TABLE IF NOT EXISTS video_death_list/);
});

test('production exclusion operations contain no schema guard awaits', () => {
  assert.doesNotMatch(blocklist, /await ensurePlaybackExclusionTable/);
  assert.doesNotMatch(deathList, /await ensureVideoDeathListTable/);
});
