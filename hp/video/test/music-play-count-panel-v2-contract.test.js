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
const nativeStats = readFileSync(
  new URL('../../native/src/stationhead_native_stats.h', import.meta.url),
  'utf8',
);

test('the compiled Music panel uses the v2 implementation', () => {
  assert.match(entry, /#include "media_section_v2\.inc"/);
  assert.match(panel, /void Renderer::DrawMusicSection/);
});

test('every requested period has an independently rendered value cell', () => {
  for (const label of ['直近1時間', '本日', '昨日', '今週', '先週']) {
    assert.match(panel, new RegExp(`L"${label}"`));
  }
  assert.match(panel, /for \(size_t index = 0; index < kPlayMetricLabels\.size\(\); \+\+index\)/);
  assert.match(panel, /DrawWidgetCard\(dc, cell/);
  assert.match(panel, /DrawTextInRect\(\s*dc,\s*playMetricValues\[index\]/);
  assert.match(panel, /L"--"/);
});

test('native WebView2 traffic supplies credentials and responses', () => {
  assert.match(nativeStats, /add_WebResourceRequested/);
  assert.match(nativeStats, /ICoreWebView2HttpRequestHeaders/);
  assert.match(nativeStats, /GetHeader\(/);
  assert.match(nativeStats, /add_WebResourceResponseReceived/);
  assert.match(nativeStats, /ICoreWebView2WebResourceResponseView/);
  assert.match(nativeStats, /GetContent\(/);
});

test('native WinHTTP actively downloads and publishes play counts', () => {
  assert.match(nativeStats, /class StationheadNativeStatsClient/);
  assert.match(nativeStats, /WinHttpDownload\(/);
  assert.match(nativeStats, /\/streakStats/);
  assert.match(nativeStats, /ParseStationheadNativeStatsJson/);
  assert.match(nativeStats, /GlobalStationheadNativeStatsStore\(\)\.Publish/);
  assert.match(nativeStats, /kStationheadNativeStatsSuccessIntervalMs/);
  assert.match(nativeStats, /kStationheadNativeStatsRetryIntervalMs/);
});

test('the native path has no generated script or WebMessage protocol', () => {
  assert.doesNotMatch(nativeStats, /LR"JS|ExecuteScript|postMessage|chrome\?\.webview/);
  assert.doesNotMatch(nativeStats, /document_generation|auth_generation|request_id/);
  assert.doesNotMatch(nativeStats, /localStorage|sessionStorage/);
});
