import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const nativeRoot = fileURLToPath(new URL('../../native/src/', import.meta.url));

function nativeSources(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return nativeSources(path);
    if (!/\.(?:h|hpp|cpp|cc|cxx|inc)$/i.test(entry.name)) return [];
    return [readFileSync(path, 'utf8')];
  });
}

const nativeSource = nativeSources(nativeRoot).join('\n');

test('Spotify renderer uses Windows efficiency-mode throttling without idle priority', () => {
  assert.match(nativeSource, /ApplySpotifyPermanentResourceMode/);
  assert.match(nativeSource, /ProcessPowerThrottling/);
  assert.match(nativeSource, /PROCESS_POWER_THROTTLING_EXECUTION_SPEED/);
  assert.match(nativeSource, /BELOW_NORMAL_PRIORITY_CLASS/);
  assert.match(nativeSource, /COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW/);
  assert.doesNotMatch(nativeSource, /IDLE_PRIORITY_CLASS/);
});
