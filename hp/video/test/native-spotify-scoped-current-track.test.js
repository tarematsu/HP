import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url), 'utf8');

const wrapper = source('spotify_webviews.inc');
const scoped = source('spotify_scoped_track_reconcile.inc');
const music = source('spotify_music_target.inc');
const observerRuntime = source('spotify_media_observer_runtime.inc');

test('active music reconcile directly uses the now-playing-scoped script', () => {
  assert.match(wrapper, /#include "spotify_scoped_track_reconcile\.inc"/);
  assert.match(music, /ExecuteScript\(\s*kSpotifyScopedTrackReconcileScript/);
  assert.doesNotMatch(wrapper, /#define kSpotifyStaticTrackReconcileScript|#undef kSpotifyStaticTrackReconcileScript/);
  assert.doesNotMatch(music, /kSpotifyStaticTrackReconcileScript/);
});

test('current-track identity never falls back to an arbitrary track-list row', () => {
  assert.match(scoped, /\[data-testid="now-playing-widget"\] a\[href\*="\/track\/"\]/);
  assert.match(scoped, /\[data-testid="now-playing-bar"\] \[data-testid="context-item-link"\]/);
  assert.match(scoped, /footer \[data-testid="context-item-link"\]/);
  assert.doesNotMatch(scoped, /^\s*'\[data-testid="context-item-link"\]\[href\*="\/track\/"\]'\s*,?\s*$/m);
  assert.match(scoped, /navigator\.mediaSession/);
});

test('play-button fallback is limited to the requested direct track page and explicit Play', () => {
  assert.match(scoped, /const onTargetPage = \(\) =>/);
  assert.match(scoped, /targetPath\.startsWith\('\/track\/'\)/);
  assert.match(scoped, /location\.pathname\.endsWith\(targetPath\)/);
  assert.match(scoped, /button\[data-testid="play-button"\]/);
  assert.match(scoped, /if \(buttonIntentValue === 'play'\) return point\(button\)/);
  assert.match(scoped, /controlIntent === 'pause'[\s\S]*return 'settling'/);
});

test('reconcile and observer runtime tolerate localized Spotify track paths', () => {
  assert.match(scoped, /const sameTrackPath =/);
  assert.match(scoped, /value\.endsWith\(expected\)/);
  assert.match(observerRuntime, /const sameTrackPath =/);
  assert.match(observerRuntime, /value\.endsWith\(expected\)/);
});
