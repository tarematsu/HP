import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const scripts = readFileSync(
  new URL('../../native/src/spotify_static_scripts.inc', import.meta.url),
  'utf8',
);
const scoped = readFileSync(
  new URL('../../native/src/spotify_scoped_track_reconcile.inc', import.meta.url),
  'utf8',
);
const click = readFileSync(
  new URL('../../native/src/spotify_background_click.inc', import.meta.url),
  'utf8',
);
const wrapper = readFileSync(
  new URL('../../native/src/spotify_webviews.inc', import.meta.url),
  'utf8',
);

test('Spotify music reconcile scrolls the selected Play control before returning CSS click points', () => {
  assert.match(scoped, /element\.scrollIntoView\(\{ block: 'center', inline: 'nearest' \}\)/);
  assert.match(scoped, /if \(element\.isConnected === false\) return null/);
  assert.match(scoped, /return \[centerX, centerY\]/);
  assert.doesNotMatch(scoped, /centerX \/ window\.innerWidth|centerY \/ window\.innerHeight|10000/);
});

test('music reconcile uses now-playing identity only for background Pause confirmation', () => {
  assert.match(scoped, /button\[data-testid="play-button"\]/);
  assert.match(scoped, /button\[data-testid="control-button-playpause"\]/);
  assert.match(scoped, /currentTrackMatchesTarget/);
  assert.match(scoped, /context-item-link/);
  assert.match(scoped, /playerPause && currentTrackMatchesTarget\(\)/);
  assert.doesNotMatch(scoped, /targetLink|tracklist-row/);
  assert.doesNotMatch(scoped, /point\(playerPause\)/);
  assert.match(click, /ClickSlotCssPoint/);
  assert.match(click, /RefreshSpotifyHostLayout\(\)/);
  assert.doesNotMatch(scripts + scoped, /\/episode\//);
});

test('viewport recovery is compiled into fixed responsibility modules with no runtime repair pass', () => {
  assert.match(wrapper, /#include "spotify_static_scripts\.inc"/);
  assert.match(wrapper, /#include "spotify_scoped_track_reconcile\.inc"/);
  assert.match(wrapper, /#include "spotify_background_click\.inc"/);
  assert.doesNotMatch(wrapper, /spotify_viewport_recovery\.inc|RewriteSpotifyViewportRecoveryScript|RewriteSpotifyPhaseExecuteScript/);
  assert.doesNotMatch(scripts + scoped, /ReplaceSpotifyScriptFragment|\.find\(L"|\.insert\(/);
});
