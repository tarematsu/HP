import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const spotifyLayout = readFileSync(
  new URL('../../native/src/spotify_host_layout.inc', import.meta.url),
  'utf8',
);
const stationheadLifecycle = readFileSync(
  new URL('../../native/src/sh_runtime_lifecycle_script.h', import.meta.url),
  'utf8',
);

test('Spotify always uses the fixed 50% zoom factor regardless of host size', () => {
  assert.match(spotifyLayout, /kSpotifySurfaceZoom = 0\.50/);
  assert.match(
    spotifyLayout,
    /if \(controllerChanged\)[\s\S]*put_ZoomFactor\(kSpotifySurfaceZoom\)/,
  );
  assert.doesNotMatch(
    spotifyLayout,
    /width > 1|height > 1|kSpotifyExpandedSurfaceZoom|hostLayoutReducedZoomApplied/,
  );
});

test('Stationhead always applies 50% document zoom without size-dependent switching', () => {
  assert.match(
    stationheadLifecycle,
    /document\.documentElement\?\.style\.setProperty\('zoom', '0\.5'\)/,
  );
  assert.doesNotMatch(
    stationheadLifecycle,
    /innerWidth > 1|innerHeight > 1|window\.addEventListener\('resize'/,
  );
  assert.match(
    stationheadLifecycle,
    /window\.addEventListener\('pageshow',[\s\S]*zoomOut\(\)/,
  );
});
