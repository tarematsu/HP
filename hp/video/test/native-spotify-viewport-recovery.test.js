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
  assert.match(viewportRecovery, /kSpotifyLatestEpisodeNeedle/);
  assert.match(viewportRecovery, /kSpotifyTargetTrackNeedle/);
});

test('viewport repair runs after the existing Spotify mode rewrite', () => {
  assert.match(wrapper, /spotify_viewport_recovery\.inc/);
  assert.match(
    wrapper,
    /RewriteSpotifyViewportRecoveryScript\([\s\S]*RewriteSpotifyPhaseExecuteScript\(\(script\)\)/,
  );
});
