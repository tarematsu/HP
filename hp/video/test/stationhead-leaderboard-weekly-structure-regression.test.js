import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const collector = fs.readFileSync(
  path.join(repoRoot, 'native/src/stationhead_leaderboard_collector.cpp'),
  'utf8',
);

test('dedicated collector waits for and serializes the complete top 100 leaderboard', () => {
  assert.match(collector, /const allLines = String\(root\?\.innerText \|\| ''\)[\s\S]*?\.slice\(0, 1600\)/);
  assert.match(collector, /let expectedRank = 1/);
  assert.match(collector, /expectedRank <= 100/);
  assert.match(collector, /match\(\/\^@\(\[a-z0-9\]\[a-z0-9_\.\-\]\{0,63\}\)\$\/i\)/);
  assert.match(collector, /leaderboard\.push\(\{ rank: expectedRank, host \}\)/);
  assert.match(collector, /leaderboard\.length >= 100/);
  assert.match(collector, /leaderboard,/);
});

test('snapshot size reduction never drops the normalized leaderboard', () => {
  for (const optionalField of ['resource_paths', 'links', 'lines', 'rows']) {
    assert.match(collector, new RegExp(`reduced\\.Remove\\(L"${optionalField}"\\)`));
  }
  assert.doesNotMatch(collector, /reduced\.Remove\(L"leaderboard"\)/);
});
