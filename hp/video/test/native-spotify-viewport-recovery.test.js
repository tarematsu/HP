import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const scripts = readFileSync(
  new URL('../../native/src/spotify_static_scripts.inc', import.meta.url),
  'utf8',
);
const wrapper = readFileSync(
  new URL('../../native/src/spotify_webviews.inc', import.meta.url),
  'utf8',
);
const phaseSync = readFileSync(
  new URL('../../native/src/spotify_phase_sync.inc', import.meta.url),
  'utf8',
);

test('Spotify fixed scripts scroll offscreen controls before returning normalized click points', () => {
  assert.match(scripts, /element\.scrollIntoView\(\{ block: 'center', inline: 'nearest' \}\)/);
  assert.match(scripts, /if \(!element\.isConnected\) return null/);
  assert.match(scripts, /centerX \/ window\.innerWidth/);
  assert.match(scripts, /centerY \/ window\.innerHeight/);
});

test('TALKABOUT episode rows and music target rows are revealed before trusted recovery clicks', () => {
  assert.match(scripts, /const latest = links\[0\];[\s\S]*latest\.scrollIntoView/);
  assert.match(scripts, /const link = targetLink\(\);[\s\S]*link\.scrollIntoView/);
  assert.match(phaseSync, /ClickSlotNormalizedPoint/);
});

test('viewport recovery is compiled into fixed scripts with no runtime repair pass', () => {
  assert.match(wrapper, /#include "spotify_static_scripts\.inc"/);
  assert.doesNotMatch(wrapper, /spotify_viewport_recovery\.inc|RewriteSpotifyViewportRecoveryScript|RewriteSpotifyPhaseExecuteScript/);
  assert.doesNotMatch(scripts, /ReplaceSpotifyScriptFragment|\.find\(L"|\.insert\(/);
});
