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
const july19Policy = readFileSync(
  new URL('../../native/src/sh_july19_stats_policy_fix.h', import.meta.url),
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
  assert.match(panel, /L"--"/);
});

test('the native stats facade only accepts and exposes browser results', () => {
  assert.match(nativeStatsHeader, /PublishStationheadNativeStatsMessage/);
  assert.match(nativeStatsHeader, /class StationheadNativeStatsAccess final/);
  assert.doesNotMatch(
    nativeStatsHeader,
    /AttachStationheadNativeStats|WinHttpDownload|WebResourceRequested/,
  );
});

test('play-count acquisition is the July 19 authenticated Primary WebView path', () => {
  assert.match(july19Policy, /StationheadJuly19AuthCaptureScript/);
  assert.match(july19Policy, /window\.fetch = function\(input, init\)/);
  assert.match(july19Policy, /NativeXhr\.prototype\.send = function/);
  assert.match(july19Policy, /StationheadJuly19ApiPlayStatsScript/);
  assert.match(july19Policy, /window\.__homepanelStationheadAuthHeaders/);
  assert.match(july19Policy, /credentials: 'include'/);
  assert.match(july19Policy, /\/streakStats/);
  assert.match(july19Policy, /stationhead-play-stats/);

  assert.match(nativeStats, /PublishStationheadNativeStatsMessage/);
  assert.match(nativeStats, /StatsStore\(\)\.Publish/);
  assert.doesNotMatch(
    nativeStats,
    /WinHttpDownload|std::thread|WebResourceResponseReceived|Network\.responseReceived/,
  );
});
