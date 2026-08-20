import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const entry = readFileSync(
  new URL('../../native/src/renderer_panels/media_section.inc', import.meta.url),
  'utf8',
);
const panel = readFileSync(
  new URL('../../native/src/renderer_panels/media_section_v2.inc', import.meta.url),
  'utf8',
);
const playbackPolicy = readFileSync(
  new URL('../../native/src/sh_playback_resource_policy_fix.h', import.meta.url),
  'utf8',
);
const nativeStatsHeader = readFileSync(
  new URL('../../native/src/stationhead_native_stats.h', import.meta.url),
  'utf8',
);
const nativeStats = readFileSync(
  new URL('../../native/src/stationhead_native_stats.cpp', import.meta.url),
  'utf8',
);

test('the compiled Music panel uses the v2 implementation', () => {
  assert.match(entry, /#include "media_section_v2\.inc"/);
  assert.match(panel, /void Renderer::DrawMusicSection/);
});

test('every requested period is rendered as one small right-aligned line', () => {
  for (const label of ['直近1時間', '本日', '昨日', '今週', '先週']) {
    assert.match(panel, new RegExp(`L"${label}"`));
  }
  assert.match(panel, /std::wstring metricsLine/);
  assert.match(panel, /metricsLine \+= kPlayMetricLabels\[index\]/);
  assert.match(panel, /metricsLine \+= playMetricValues\[index\]/);
  assert.match(
    panel,
    /SelectObject\(dc, TierFont\(FontTier::Small\)\);[\s\S]*DrawTextInRect\(dc, metricsLine, metricsRect,[\s\S]*DT_RIGHT \| DT_SINGLELINE/,
  );
  assert.doesNotMatch(panel, /DrawWidgetCard\(dc, cell/);
  assert.doesNotMatch(panel, /usableMetricWidth/);
  assert.match(panel, /L"--"/);
});

test('the public native stats facade only accepts and exposes browser results', () => {
  assert.match(nativeStatsHeader, /PublishStationheadNativeStatsMessage/);
  assert.match(nativeStatsHeader, /class StationheadNativeStatsAccess final/);
  assert.doesNotMatch(
    nativeStatsHeader,
    /AttachStationheadNativeStats|WinHttpDownload|WebResourceRequested|JsonObject::Parse/,
  );
});

test('play-count acquisition is owned by the authenticated Primary WebView', () => {
  assert.match(playbackPolicy, /StationheadPrimaryWebViewStatsScript/);
  assert.match(playbackPolicy, /window\.__homepanelStationheadAuthHeaders/);
  assert.match(playbackPolicy, /credentials: 'include'/);
  assert.match(playbackPolicy, /\/streakStats/);
  assert.match(playbackPolicy, /stationhead-play-stats/);
  assert.doesNotMatch(playbackPolicy, /WinHttpDownload|Network\.responseReceived/);

  assert.match(nativeStats, /PublishStationheadNativeStatsMessage/);
  assert.match(nativeStats, /StatsStore\(\)\.Publish/);
  assert.doesNotMatch(
    nativeStats,
    /WinHttpDownload|std::thread|GetDevToolsProtocolEventReceiver|Network\.responseReceived/,
  );
});
