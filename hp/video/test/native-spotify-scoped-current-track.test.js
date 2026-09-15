import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url), 'utf8');

const wrapper = source('spotify_webviews.inc');
const scoped = source('spotify_scoped_track_reconcile.inc');
const music = source('spotify_music_target.inc');
const observerRuntime = source('spotify_media_observer_runtime.inc');

test('active music reconcile directly uses the scoped playback script', () => {
  assert.match(wrapper, /#include "spotify_scoped_track_reconcile\.inc"/);
  assert.match(music, /ExecuteScript\(\s*kSpotifyScopedTrackReconcileScript/);
  assert.doesNotMatch(wrapper, /#define kSpotifyStaticTrackReconcileScript|#undef kSpotifyStaticTrackReconcileScript/);
  assert.doesNotMatch(music, /kSpotifyStaticTrackReconcileScript/);
});

test('reconcile trusts the already-selected target URL instead of re-identifying the current track', () => {
  assert.match(scoped, /location\.hostname !== 'open\.spotify\.com'/);
  assert.match(scoped, /location\.pathname === targetPath/);
  assert.match(scoped, /targetPath\.startsWith\('\/track\/'\)/);
  assert.match(scoped, /location\.pathname\.endsWith\(targetPath\)/);
  assert.doesNotMatch(scoped, /now-playing-widget|now-playing-bar|context-item-link|navigator\.mediaSession|currentTrack|targetMatches/);
});

test('target-page Play is preferred and Pause is never clicked', () => {
  assert.match(scoped, /button\[data-testid="play-button"\]/);
  assert.match(scoped, /button\[data-testid="control-button-playpause"\]/);
  assert.match(scoped, /return point\(pagePlay\)/);
  assert.match(scoped, /isPauseControl\(pagePlay\)\) return true/);
  assert.match(scoped, /isPauseControl\(playerControl\)\) return 'observing'/);
  assert.match(scoped, /isPlayControl\(playerControl\)\) return point\(playerControl\)/);
  assert.doesNotMatch(scoped, /buttonIntent|settling/);
});

test('observer runtime still tolerates localized Spotify track paths for confirmation', () => {
  assert.match(observerRuntime, /const sameTrackPath =/);
  assert.match(observerRuntime, /value\.endsWith\(expected\)/);
});
