import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url), 'utf8');

const spotify = source('spotify_controller_lifecycle.inc');
const stationheadLayout = source('sh_layout.cpp');
const stationheadWebview = source('sh_webview.cpp');
const mediaHost = source('renderer_panels/media_host.inc');

test('Spotify, Stationhead and YouTube/TVer do not force a WebView2 memory target', () => {
  for (const [name, implementation] of [
    ['Spotify', spotify],
    ['Stationhead layout', stationheadLayout],
    ['Stationhead auth', stationheadWebview],
    ['YouTube/TVer', mediaHost],
  ]) {
    assert.doesNotMatch(
      implementation,
      /put_MemoryUsageTargetLevel|COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_(?:LOW|NORMAL)/,
      `${name} must leave WebView2 memory target unmanaged`,
    );
  }
});
