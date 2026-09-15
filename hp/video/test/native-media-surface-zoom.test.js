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

test('Spotify zooms out every surface larger than 1x1 and restores normal zoom at 1x1', () => {
  assert.match(spotifyLayout, /kSpotifyExpandedSurfaceZoom = 0\.50/);
  assert.match(spotifyLayout, /const bool reducedZoom = width > 1 \|\| height > 1/);
  assert.match(
    spotifyLayout,
    /put_ZoomFactor\(\s*reducedZoom \? kSpotifyExpandedSurfaceZoom : 1\.0\)/,
  );
  assert.doesNotMatch(
    spotifyLayout,
    /const bool reducedZoom = !monitorForeground_ && authentication/,
  );
});

test('Stationhead follows WebView size changes and zooms the page out above 1x1', () => {
  assert.match(
    stationheadLifecycle,
    /const zoom = innerWidth > 1 \|\| innerHeight > 1 \? '0\.5' : '1'/,
  );
  assert.match(stationheadLifecycle, /root\.style\.zoom = zoom/);
  assert.match(
    stationheadLifecycle,
    /window\.addEventListener\('resize', syncSurfaceZoom, true\)/,
  );
  assert.match(
    stationheadLifecycle,
    /window\.addEventListener\('pageshow',[\s\S]*syncSurfaceZoom\(\)/,
  );
  assert.match(stationheadLifecycle, /syncSurfaceZoom\(\);\s*run\(\);\s*armBlankRecovery\(\);\s*\}\)\(\)/);
});
