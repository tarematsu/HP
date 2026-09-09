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

test('Spotify reconcile scripts scroll offscreen controls before returning normalized click points', () => {
  for (const source of [scripts, scoped]) {
    assert.match(source, /element\.scrollIntoView\(\{ block: 'center', inline: 'nearest' \}\)/);
    assert.match(source, /if \(!element\.isConnected\) return null/);
    assert.match(source, /centerX \/ window\.innerWidth/);
    assert.match(source, /centerY \/ window\.innerHeight/);
  }
});

test('TALKABOUT episode rows and music target rows are revealed before trusted recovery clicks', () => {
  assert.match(scripts, /const latest = links\[0\];[\s\S]*latest\.scrollIntoView/);
  assert.match(scoped, /const link = targetLink\(\);[\s\S]*link\.scrollIntoView/);
  assert.match(click, /ClickSlotNormalizedPoint/);
  assert.match(click, /RefreshSpotifyHostLayout\(\)/);
});

test('viewport recovery is compiled into fixed responsibility modules with no runtime repair pass', () => {
  assert.match(wrapper, /#include "spotify_static_scripts\.inc"/);
  assert.match(wrapper, /#include "spotify_scoped_track_reconcile\.inc"/);
  assert.match(wrapper, /#include "spotify_background_click\.inc"/);
  assert.doesNotMatch(wrapper, /spotify_viewport_recovery\.inc|RewriteSpotifyViewportRecoveryScript|RewriteSpotifyPhaseExecuteScript/);
  assert.doesNotMatch(scripts + scoped, /ReplaceSpotifyScriptFragment|\.find\(L"|\.insert\(/);
});
