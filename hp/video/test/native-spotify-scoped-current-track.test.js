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
