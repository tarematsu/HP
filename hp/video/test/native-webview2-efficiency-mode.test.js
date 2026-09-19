import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const nativeRoot = fileURLToPath(new URL('../../native/src/', import.meta.url));
const spotifySource = readdirSync(nativeRoot, { withFileTypes: true })
  .filter(entry => entry.isFile() && /^spotify_.*\.(?:h|hpp|cpp|cc|cxx|inc)$/i.test(entry.name))
  .map(entry => readFileSync(join(nativeRoot, entry.name), 'utf8'))
  .join('\n');

test('Spotify does not opt into WebView2 LOW memory or Windows efficiency throttling', () => {
  assert.doesNotMatch(spotifySource, /ApplySpotifyPermanentResourceMode/);
  assert.doesNotMatch(spotifySource, /put_MemoryUsageTargetLevel/);
  assert.doesNotMatch(spotifySource, /COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW/);
  assert.doesNotMatch(spotifySource, /ProcessPowerThrottling/);
  assert.doesNotMatch(spotifySource, /PROCESS_POWER_THROTTLING_EXECUTION_SPEED/);
  assert.doesNotMatch(spotifySource, /BELOW_NORMAL_PRIORITY_CLASS/);
  assert.doesNotMatch(spotifySource, /IDLE_PRIORITY_CLASS/);
});
