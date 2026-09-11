import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const wrapper = readFileSync(
  new URL('../../native/src/spotify_webviews.inc', import.meta.url),
  'utf8',
);
const scoped = readFileSync(
  new URL('../../native/src/spotify_scoped_track_reconcile.inc', import.meta.url),
  'utf8',
);
const observerRuntime = readFileSync(
  new URL('../../native/src/spotify_media_observer_runtime.inc', import.meta.url),
  'utf8',
);

test('active music reconcile is routed through the now-playing-scoped script', () => {
  assert.match(wrapper, /#include "spotify_scoped_track_reconcile\.inc"/);
  assert.match(
    wrapper,
    /#define kSpotifyStaticTrackReconcileScript kSpotifyScopedTrackReconcileScript[\s\S]*#include "spotify_timed_sequence\.inc"[\s\S]*#include "spotify_music_target\.inc"[\s\S]*#undef kSpotifyStaticTrackReconcileScript/,
  );
});

test('current-track identity never falls back to an arbitrary track-list row', () => {
  assert.match(scoped, /\[data-testid="now-playing-widget"\] a\[href\*="\/track\/"\]/);
  assert.match(scoped, /\[data-testid="now-playing-bar"\] \[data-testid="context-item-link"\]/);
  assert.match(scoped, /footer \[data-testid="context-item-link"\]/);
  assert.doesNotMatch(
    scoped,
    /^\s*'\[data-testid="context-item-link"\]\[href\*="\/track\/"\]'\s*,?\s*$/m,
  );
  assert.match(scoped, /navigator\.mediaSession/);
});

test('play-button fallback is allowed only on the requested direct track page and only for explicit Play', () => {
  assert.match(scoped, /const onTargetPage = \(\) =>/);
  assert.match(scoped, /target\.pagePath\.startsWith\('\/track\/'\)/);
  assert.match(scoped, /location\.pathname\.endsWith\(target\.pagePath\)/);
  assert.match(
    scoped,
    /if \(target\.trackPath && onTargetPage\(\)\)[\s\S]*button\[data-testid="play-button"\][\s\S]*return null;/,
  );
  assert.match(scoped, /const buttonIntent = button =>/);
  assert.match(scoped, /if \(buttonIntentValue === 'play'\) return point\(button\)/);
  assert.match(scoped, /controlIntent === 'pause'[\s\S]*return 'settling'/);
  assert.doesNotMatch(scoped, /buttonShowsPlaying/);
});

test('reconcile and observer runtime tolerate localized Spotify track paths', () => {
  assert.match(scoped, /const sameTrackPath =/);
  assert.match(scoped, /value\.endsWith\(expected\)/);
  assert.match(observerRuntime, /const sameTrackPath =/);
  assert.match(observerRuntime, /value\.endsWith\(expected\)/);
});
