import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const wrapper = readFileSync(
  new URL('../../native/src/spotify_webviews.inc', import.meta.url),
  'utf8',
);
const helper = readFileSync(
  new URL('../../native/src/spotify_background_click.inc', import.meta.url),
  'utf8',
);
const header = readFileSync(
  new URL('../../native/src/spotify_webviews.h', import.meta.url),
  'utf8',
);

test('Spotify recovery clicks are dispatched inside WebView2 instead of the OS foreground window', () => {
  assert.match(wrapper, /#define SendInput\(count, inputs, inputSize\)/);
  assert.match(wrapper, /DispatchSpotifyDevToolsClick\(slot, xTenThousandths, yTenThousandths\)/);
  assert.match(helper, /CallDevToolsProtocolMethod\(/);
  assert.match(helper, /L"Input\.dispatchMouseEvent"/);
  assert.match(helper, /mousePressed/);
  assert.match(helper, /mouseReleased/);
  assert.doesNotMatch(helper, /SetForegroundWindow/);
  assert.doesNotMatch(helper, /SendInput/);
});

test('each recovering Spotify slot is expanded even when another slot already keeps global foreground true', () => {
  assert.match(header, /RecomputeForegroundAndRefreshSpotifyHostLayout/);
  assert.match(wrapper, /#define RecomputeForeground\(\) RecomputeForegroundAndRefreshSpotifyHostLayout\(\)/);
  assert.match(
    helper,
    /RecomputeForeground\(\);[\s\S]*RefreshSpotifyHostLayout\(\);/,
  );
});
