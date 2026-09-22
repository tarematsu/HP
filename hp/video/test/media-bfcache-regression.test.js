import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const environmentSource = readFileSync(
  new URL('../../native/src/shared_webview_environment.cpp', import.meta.url),
  'utf8',
);
const mediaHost = readFileSync(
  new URL('../../native/src/renderer_panels/media_host.inc', import.meta.url),
  'utf8',
);

test('YouTube/TVer shared media environment disables back-forward cache', () => {
  const fullResourceStart = environmentSource.indexOf(
    'constexpr wchar_t kFullResourceWebView2Arguments[]',
  );
  const stationheadStart = environmentSource.indexOf(
    'constexpr wchar_t kStationheadWebView2Arguments[]',
  );
  assert.ok(fullResourceStart >= 0 && stationheadStart > fullResourceStart);

  const fullResourceArguments = environmentSource
    .slice(fullResourceStart, stationheadStart)
    .replace(/"\s*L"/g, '');

  assert.match(fullResourceArguments, /--disable-features=BackForwardCache,/);
  assert.match(mediaHost, /enum class Phase \{ YouTube, Tver \}/);
  assert.match(mediaHost, /webview_->Navigate\(kNativeMediaYoutubeUrl\)/);
  assert.match(mediaHost, /webview_->Navigate\(url\.c_str\(\)\)/);
});

test('shared UDF keeps auth images enabled while disabling downloadable web fonts', () => {
  assert.match(environmentSource, /blockImages = false;/);
  assert.match(environmentSource, /blockFonts = true;/);
  assert.match(environmentSource, /imagesEnabled=false,loadsImagesAutomatically=false/);
  assert.match(environmentSource, /downloadableBinaryFontsEnabled=false/);
  assert.doesNotMatch(mediaHost, /COREWEBVIEW2_WEB_RESOURCE_CONTEXT_(?:IMAGE|FONT)/);
});
