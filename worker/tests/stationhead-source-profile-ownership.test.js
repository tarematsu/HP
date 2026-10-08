import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const workerRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceProfile = readFileSync(
  new URL('../../packages/sh-shared/stationhead-source.mjs', import.meta.url),
  'utf8',
);
const PROFILE_OWNED_KEYS = Object.freeze([
  'stationhead/buddies/playback-state.json',
  'stationhead/buddies/dashboard-hot-state.json',
  'stationhead/ohisama/playback-state.json',
  'stationhead/ohisama/read-model-hot-state.json',
  'stationhead/ohisama/collector-state.json',
  'stationhead/nogizaka/playback-state.json',
  'stationhead/nogizaka/read-model-hot-state.json',
]);

function sourceFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(path));
    else if (['.js', '.mjs', '.cjs'].includes(extname(entry.name))) files.push(path);
  }
  return files;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^$(){}|[\]\\]/g, '\\$&');
}

test('Stationhead source profile exclusively owns shared hot-state keys', () => {
  for (const key of PROFILE_OWNED_KEYS) assert.match(sourceProfile, new RegExp(escapeRegExp(key)));

  const duplicates = [];
  for (const directory of [join(workerRoot, 'src'), join(workerRoot, 'scripts')]) {
    for (const path of sourceFiles(directory)) {
      const source = readFileSync(path, 'utf8');
      for (const key of PROFILE_OWNED_KEYS) {
        if (source.includes(key)) duplicates.push({ path, key });
      }
    }
  }
  assert.deepEqual(duplicates, []);
});
