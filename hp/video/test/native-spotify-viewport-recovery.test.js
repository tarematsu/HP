import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const viewportRecovery = readFileSync(
  new URL('../../native/src/spotify_viewport_recovery.inc', import.meta.url),
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
const lonesomeGuard = readFileSync(
  new URL('../../native/src/spotify_lonesome_guard.inc', import.meta.url),
  'utf8',
);

test('Spotify recovery scrolls offscreen controls into the WebView before returning a click point', () => {
  assert.match(viewportRecovery, /element\.scrollIntoView\(\{ block: 'center', inline: 'nearest' \}\)/);
  assert.match(viewportRecovery, /centerY < 0 \|\| centerY > window\.innerHeight/);
  assert.match(viewportRecovery, /if \(!element\.isConnected\) return null/);
  assert.match(viewportRecovery, /centerX \/ window\.innerWidth/);
  assert.match(viewportRecovery, /centerY \/ window\.innerHeight/);
});

test('TALKABOUT latest episode and Lonesome rabbit track rows are revealed before trusted recovery clicks', () => {
  assert.match(viewportRecovery, /latest\.scrollIntoView/);
  assert.match(viewportRecovery, /targetLink\.scrollIntoView/);
  assert.match(phaseSync, /const latest = links\[0\];\s*const container = latest\.closest/);
  assert.match(lonesomeGuard, /if \(targetLink\) \{\s*const row = targetLink\.closest/);
});

test('viewport repair runs after the existing Spotify mode rewrite', () => {
  assert.match(wrapper, /spotify_viewport_recovery\.inc/);
  assert.match(
    wrapper,
    /RewriteSpotifyViewportRecoveryScript\([\s\S]*RewriteSpotifyPhaseExecuteScript\(\(script\)\)/,
  );
  assert.match(phaseSync, /const point = element => \{[\s\S]*const rect = element\.getBoundingClientRect\(\);[\s\S]*return \[/);
  assert.match(lonesomeGuard, /const point = element => \{[\s\S]*const rect = element\.getBoundingClientRect\(\);[\s\S]*return \[/);
});
