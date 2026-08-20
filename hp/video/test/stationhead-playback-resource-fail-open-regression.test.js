import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const playbackPolicy = readFileSync(
  new URL('../../native/src/sh_playback_resource_policy_fix.h', import.meta.url),
  'utf8',
);
const july19Policy = readFileSync(
  new URL('../../native/src/sh_july19_stats_policy_fix.h', import.meta.url),
  'utf8',
);
const composition = readFileSync(
  new URL('../../native/src/sh_track_boundary_script.h', import.meta.url),
  'utf8',
);
const nativeStats = readFileSync(
  new URL('../../native/src/stationhead_native_stats.cpp', import.meta.url),
  'utf8',
);
const sharedEnvironment = readFileSync(
  new URL('../../native/src/shared_webview_environment.cpp', import.meta.url),
  'utf8',
);

test('July 19 policy is included after the later playback boundary', () => {
  const playbackAt = composition.indexOf('#include "sh_playback_resource_policy_fix.h"');
  const july19At = composition.indexOf('#include "sh_july19_stats_policy_fix.h"');
  assert.ok(playbackAt >= 0);
  assert.ok(july19At > playbackAt);
  assert.match(
    july19Policy,
    /#define ApplyStationheadResourceBlocking ApplyStationheadJuly19ResourcePolicy/,
  );
});

test('final July 19 resource boundary remains fail-open', () => {
  assert.match(july19Policy, /Network\.clearBrowserCache/);
  assert.doesNotMatch(
    july19Policy,
    /AddWebResourceRequestedFilter|add_WebResourceRequested|Network\.setBlockedURLs|CreateWebResourceResponse|put_Response/,
  );
  assert.doesNotMatch(july19Policy, /AttachStationheadNativeStats/);
});

test('later native observer implementation is superseded and not used by final policy', () => {
  assert.match(playbackPolicy, /AttachStationheadNativeStats/);
  assert.doesNotMatch(nativeStats, /WebResourceResponseReceived|WinHttpDownload|std::thread/);
  assert.match(july19Policy, /StationheadJuly19ApiPlayStatsScript/);
  assert.match(july19Policy, /credentials: 'include'/);
});

test('safe image and font reduction remains environment-level', () => {
  assert.match(sharedEnvironment, /std::wstring BuildWebView2Arguments\(bool blockImages, bool blockFonts\)/);
  assert.match(sharedEnvironment, /imagesEnabled=false,loadsImagesAutomatically=false/);
  assert.match(sharedEnvironment, /downloadableBinaryFontsEnabled=false/);
});
