import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const playbackPolicy = readFileSync(
  new URL('../../native/src/sh_playback_resource_policy_fix.h', import.meta.url),
  'utf8',
);
const stableStatsPolicy = readFileSync(
  new URL('../../native/src/sh_july19_stats_policy_fix.h', import.meta.url),
  'utf8',
);
const composition = readFileSync(
  new URL('../../native/src/sh_track_boundary_script.h', import.meta.url),
  'utf8',
);
const sharedEnvironment = readFileSync(
  new URL('../../native/src/shared_webview_environment.cpp', import.meta.url),
  'utf8',
);

test('stable stats selection is included after the playback boundary', () => {
  const playbackAt = composition.indexOf('#include "sh_playback_resource_policy_fix.h"');
  const statsAt = composition.indexOf('#include "sh_july19_stats_policy_fix.h"');
  assert.ok(playbackAt >= 0);
  assert.ok(statsAt > playbackAt);
});

test('stats restoration does not replace the current playback resource policy', () => {
  assert.doesNotMatch(stableStatsPolicy, /#define ApplyStationheadResourceBlocking/);
  assert.doesNotMatch(stableStatsPolicy, /AddWebResourceRequestedFilter|add_WebResourceRequested|Network\.setBlockedURLs|CreateWebResourceResponse|put_Response/);
  assert.match(playbackPolicy, /ApplyStationheadResourceBlockingPlaybackSafe/);
});

test('play-count request stays in the authenticated Primary WebView', () => {
  assert.match(stableStatsPolicy, /StationheadPre368ApiPlayStatsScript/);
  assert.match(stableStatsPolicy, /credentials: 'include'/);
  assert.match(stableStatsPolicy, /\/streakStats/);
  assert.doesNotMatch(stableStatsPolicy, /AttachStationheadNativeStats|WinHttpDownload/);
});

test('safe image and font reduction remains environment-level', () => {
  assert.match(sharedEnvironment, /std::wstring BuildWebView2Arguments\(bool blockImages, bool blockFonts\)/);
  assert.match(sharedEnvironment, /imagesEnabled=false,loadsImagesAutomatically=false/);
  assert.match(sharedEnvironment, /downloadableBinaryFontsEnabled=false/);
});
