import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const nativeRoot = fileURLToPath(new URL('../../native/src/', import.meta.url));
const source = name => readFileSync(new URL(`../../native/src/${name}`, import.meta.url), 'utf8');

const spotifySource = readdirSync(nativeRoot, { withFileTypes: true })
  .filter(entry => entry.isFile() && /^spotify_.*\.(?:h|hpp|cpp|cc|cxx|inc)$/i.test(entry.name))
  .map(entry => readFileSync(join(nativeRoot, entry.name), 'utf8'))
  .join('\n');
const stationheadResourceMode = source('stationhead_permanent_resource_mode.h');

test('Spotify does not set a WebView2 memory usage target', () => {
  assert.doesNotMatch(spotifySource, /put_MemoryUsageTargetLevel/);
  assert.doesNotMatch(
    spotifySource,
    /COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_(?:LOW|NORMAL)/,
  );
});

test('Stationhead remains the permanent LOW-memory WebView2 exception', () => {
  assert.match(stationheadResourceMode, /put_MemoryUsageTargetLevel/);
  assert.match(
    stationheadResourceMode,
    /COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW/,
  );
  assert.doesNotMatch(
    stationheadResourceMode,
    /COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL/,
  );
});
