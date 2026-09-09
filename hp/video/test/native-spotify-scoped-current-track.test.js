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
const observer = readFileSync(
  new URL('../../native/src/spotify_fast_end_observer.inc', import.meta.url),
  'utf8',
);

test('active music reconcile is routed through the now-playing-scoped script', () => {
  assert.match(wrapper, /#include "spotify_scoped_track_reconcile\.inc"/);
  assert.match(
    wrapper,
    /#define kSpotifyStaticTrackReconcileScript kSpotifyScopedTrackReconcileScript[\s\S]*#include "spotify_timed_sequence\.inc"[\s\S]*#include "spotify_recent_catalog\.inc"[\s\S]*#undef kSpotifyStaticTrackReconcileScript/,
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

test('play-button fallback is allowed only on the requested direct track page', () => {
  assert.match(scoped, /const onTargetPage = \(\) =>/);
  assert.match(scoped, /target\.pagePath\.startsWith\('\/track\/'\)/);
  assert.match(scoped, /location\.pathname\.endsWith\(target\.pagePath\)/);
  assert.match(
    scoped,
    /if \(target\.trackPath && onTargetPage\(\)\)[\s\S]*button\[data-testid="play-button"\][\s\S]*return null;/,
  );
  assert.match(scoped, /buttonShowsPlaying\(button\)/);
});

test('reconcile and end observer tolerate localized Spotify track paths', () => {
  assert.match(scoped, /const sameTrackPath =/);
  assert.match(scoped, /value\.endsWith\(expected\)/);
  assert.match(observer, /const sameTrackPath =/);
  assert.match(observer, /value\.endsWith\(expected\)/);
});
