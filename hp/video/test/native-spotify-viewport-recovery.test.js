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

test('Spotify music reconcile scrolls offscreen controls before returning normalized click points', () => {
  assert.match(scoped, /element\.scrollIntoView\(\{ block: 'center', inline: 'nearest' \}\)/);
  assert.match(scoped, /if \(!element\.isConnected\) return null/);
  assert.match(scoped, /centerX \/ window\.innerWidth/);
  assert.match(scoped, /centerY \/ window\.innerHeight/);
});

test('music reconcile reveals the requested target row before trusted recovery input', () => {
  assert.match(scoped, /const link = targetLink\(\);[\s\S]*link\.scrollIntoView/);
  assert.match(click, /ClickSlotNormalizedPoint/);
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
