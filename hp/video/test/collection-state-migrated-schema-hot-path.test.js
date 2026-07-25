import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const compaction = await readFile(new URL('../src/d1-compaction.js', import.meta.url), 'utf8');
const runs = await readFile(new URL('../src/source-feed-run-records.js', import.meta.url), 'utf8');
const captures = await readFile(new URL('../src/collection-capture.js', import.meta.url), 'utf8');

test('migrated collection state guards remain synchronous compatibility no-ops', () => {
  assert.match(compaction, /export function ensureD1Compaction\(\) \{\s+return undefined;/);
  assert.match(runs, /export function ensureCollectionTimingTable\(\) \{\s+return undefined;/);
  assert.match(captures, /export function ensureCollectionCaptureTables\(\) \{\s+return undefined;/);
});

test('feed state and collection paths contain no migrated guard awaits', () => {
  assert.doesNotMatch(compaction, /await ensureD1Compaction/);
  assert.doesNotMatch(runs, /await ensureCollectionTimingTable/);
  assert.doesNotMatch(captures, /await ensureCollectionCaptureTables/);
});

test('collection state modules contain no dormant migration-owned DDL', () => {
  assert.doesNotMatch(compaction, /ensureDatabaseOnce/);
  assert.doesNotMatch(runs, /ensureDatabaseOnce/);
  assert.doesNotMatch(captures, /ensureDatabaseOnce/);
  assert.doesNotMatch(compaction, /CREATE TABLE IF NOT EXISTS playback_feed_state/);
  assert.doesNotMatch(runs, /CREATE TABLE IF NOT EXISTS collection_run_timings/);
  assert.doesNotMatch(captures, /CREATE TABLE IF NOT EXISTS collection_capture_snapshots/);
});
