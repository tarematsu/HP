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
const wrapper = readFileSync(
  new URL('../../native/src/spotify_webviews.inc', import.meta.url),
  'utf8',
);
const header = readFileSync(
  new URL('../../native/src/spotify_webviews.h', import.meta.url),
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

test('ultra-light styling uses persistent CSS without a high-churn MutationObserver', () => {
  assert.match(guard, /kSpotifyUltraLightPreamble/);
  assert.match(guard, /background-image: none !important/);
  assert.match(guard, /img, picture, video, canvas/);
  assert.match(guard, /display: none !important/);
  assert.doesNotMatch(guard, /MutationObserver/);
  assert.doesNotMatch(guard, /__homePanelSpotifyUltraLightObserver/);
  assert.doesNotMatch(guard, /querySelectorAll\('img'\)/);
  assert.match(guard, /rewritten\.assign\(kSpotifyUltraLightPreamble\)/);
  assert.match(guard, /rewritten\.append\(selected\)/);
  assert.doesNotMatch(guard, /audio\s*\{/);
});

test('healthy Lonesome rabbit slots only run a full DOM check about once per minute', () => {
  assert.match(guard, /kSpotifyHealthyMusicFullCheckRounds = 5/);
  assert.match(guard, /const bool isMusicPass/);
  assert.match(guard, /const size_t dispatched = reconcileIndex_ - 1/);
  assert.match(guard, /const size_t slotIndex = dispatched % slots_\.size\(\)/);
  assert.match(guard, /const size_t round = dispatched \/ slots_\.size\(\)/);
  assert.match(
    guard,
    /slots_\[slotIndex\]\.playing[\s\S]*round % kSpotifyHealthyMusicFullCheckRounds[\s\S]*return L"true"/,
  );
  assert.match(guard, /TALKABOUT stays on the[\s\S]*normal cadence/);
});

test('only unhealthy Spotify hosts stay expanded while healthy hosts collapse to 1x1', () => {
  assert.match(header, /unsigned hostLayoutMask_ = ~0u/);
  assert.match(header, /DeferSpotifyHostWindowPos/);
  assert.match(header, /SetSpotifyHostWindowPos/);
  assert.match(wrapper, /#define DeferWindowPos/);
  assert.match(wrapper, /#define SetWindowPos/);
  assert.match(guard, /slot && slot->playing && width > 1 && height > 1/);
  assert.match(guard, /width = 1;\s*height = 1;\s*insertAfter = HWND_BOTTOM/);
  assert.match(guard, /void SpotifyWebViews::RefreshSpotifyHostLayout\(\) noexcept/);
  assert.match(guard, /if \(!slots_\[i\]\.playing\) mask \|= \(1u << i\)/);
  assert.match(guard, /PlaceHosts\(mask != 0\)/);
});
