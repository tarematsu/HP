import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../src/status-report.js', import.meta.url), 'utf8');

test('status report uses one batched read without chained health arrays', () => {
  assert.doesNotMatch(source, /ensureCollectionTimingTable/);
  assert.doesNotMatch(source, /ensureLivenessStateTable/);
  assert.doesNotMatch(source, /Object\.entries\(manualSiteSummary\.sites\)[\s\S]*?\.filter\([\s\S]*?\.map\(/);
  assert.doesNotMatch(source, /Object\.keys\(manualSiteSummary\.sites\)/);
  assert.match(source, /for \(const key in manualSiteSummary\.sites\)/);
  assert.match(source, /env\.DB\.batch\(\[/);
  assert.match(source, /prepareStatusCountsRead\(env\.DB\)/);
  assert.match(source, /manualImportRunsStatement\(env\.DB\)/);
  assert.match(source, /prepareLivenessStateRead\(env\.DB\)/);
});
