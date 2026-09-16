import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url), 'utf8');

const spotify = source('spotify_controller_lifecycle.inc');
const stationheadLayout = source('sh_layout.cpp');
const stationheadWebview = source('sh_webview.cpp');
const mediaHost = source('renderer_panels/media_host.inc');
const featurePolicy = source('webview_feature_policy.h');

test('YouTube/TVer use experimental WebView2 low-memory target only', () => {
  assert.match(
    mediaHost,
    /ApplyMediaWebViewFeaturePolicy\(\s*controller_\.Get\(\), webview_\.Get\(\), false\)/,
    'YouTube/TVer must use the native-media feature-policy path',
  );
  assert.match(
    featurePolicy,
    /if \(!webMessagesEnabled\) \{[\s\S]*ICoreWebView2_19[\s\S]*put_MemoryUsageTargetLevel\([\s\S]*COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW/,
    'native YouTube/TVer must request the low memory target',
  );

  for (const [name, implementation] of [
    ['Spotify', spotify],
    ['Stationhead layout', stationheadLayout],
    ['Stationhead WebView', stationheadWebview],
  ]) {
    assert.doesNotMatch(
      implementation,
      /put_MemoryUsageTargetLevel|COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_(?:LOW|NORMAL)/,
      `${name} must leave WebView2 memory target unmanaged`,
    );
  }

  assert.match(
    spotify,
    /ApplyMediaWebViewFeaturePolicy\([\s\S]*true\)/,
    'Spotify must stay on the normal media policy path',
  );
  assert.match(
    stationheadWebview,
    /ApplyMediaWebViewFeaturePolicy\(controller_\.Get\(\), webview_\.Get\(\), true\)/,
    'Stationhead must stay on the normal media policy path',
  );
});
