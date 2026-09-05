import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const phaseSync = readFileSync(
  new URL('../../native/src/spotify_phase_sync.inc', import.meta.url),
  'utf8',
);
const guard = readFileSync(
  new URL('../../native/src/spotify_lonesome_guard.inc', import.meta.url),
  'utf8',
);

test('slow six-window startup does not reload after only three failed playback probes', () => {
  assert.match(phaseSync, /kSpotifyRobustUnhealthyLimit = 3/);
  assert.match(phaseSync, /kSpotifyRobustSlowLoadMultiplier = 10/);
  assert.match(
    phaseSync,
    /kSpotifyRobustReloadThreshold\s*=\s*[\s\S]*kSpotifyRobustUnhealthyLimit \* kSpotifyRobustSlowLoadMultiplier/,
  );
  assert.match(
    phaseSync,
    /\+\+target->unhealthyChecks >= kSpotifyRobustReloadThreshold/,
  );
  assert.match(
    phaseSync,
    /\+\+slot\.unhealthyChecks >= kSpotifyRobustReloadThreshold/,
  );
});

test('a usable Spotify play control keeps recovery on trusted clicks instead of reloading the page', () => {
  assert.match(
    phaseSync,
    /if \(hasPoint\) \{[\s\S]*target->unhealthyChecks = 0;[\s\S]*ClickSlotNormalizedPoint\(\*target, x, y\);[\s\S]*return S_OK;/,
  );
});

test('all robust Spotify modes strip image-heavy decorative rendering', () => {
  assert.match(guard, /kSpotifyUltraLightPreamble/);
  assert.match(guard, /background-image: none !important/);
  assert.match(guard, /img, picture, video, canvas/);
  assert.match(guard, /display: none !important/);
  assert.match(guard, /MutationObserver\(stripDecorations\)/);
  assert.match(guard, /window\.__homePanelSpotifyUltraLightObserver/);
  assert.match(guard, /rewritten\.assign\(kSpotifyUltraLightPreamble\)/);
  assert.match(guard, /rewritten\.append\(selected\)/);
  assert.doesNotMatch(guard, /audio\s*\{/);
});
