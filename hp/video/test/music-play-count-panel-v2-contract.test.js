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

test('every requested period has an independently rendered value cell', () => {
  for (const label of ['直近1時間', '本日', '昨日', '今週', '先週']) {
    assert.match(panel, new RegExp(`L"${label}"`));
  }
  assert.match(panel, /for \(size_t index = 0; index < kPlayMetricLabels\.size\(\); \+\+index\)/);
  assert.match(panel, /DrawWidgetCard\(dc, cell/);
  assert.match(panel, /DrawTextInRect\(\s*dc,\s*playMetricValues\[index\]/);
  assert.match(panel, /L"--"/);
});

test('the public header is declarations and a narrow renderer facade only', () => {
  assert.match(nativeStatsHeader, /void AttachStationheadNativeStats/);
  assert.match(nativeStatsHeader, /class StationheadNativeStatsAccess final/);
  assert.doesNotMatch(nativeStatsHeader, /WinHttpDownload|WebResourceRequested|JsonObject::Parse/);
});

test('native WebView2 traffic supplies credentials and responses', () => {
  assert.match(nativeStats, /add_WebResourceRequested/);
  assert.match(nativeStats, /ICoreWebView2HttpRequestHeaders/);
  assert.match(nativeStats, /GetHeader\(/);
  assert.match(nativeStats, /add_WebResourceResponseReceived/);
  assert.match(nativeStats, /ICoreWebView2WebResourceResponseView/);
  assert.match(nativeStats, /GetContent\(/);
});

test('one autonomous native worker actively downloads and publishes play counts', () => {
  assert.match(nativeStats, /class NativeStatsClient/);
  assert.match(nativeStats, /std::condition_variable wake_/);
  assert.match(nativeStats, /std::thread\(\[this\] \{ WorkerLoop\(\); \}\)\.detach\(\)/);
  assert.match(nativeStats, /wake_\.wait_until\(lock, nextAttempt_\)/);
  assert.match(nativeStats, /WinHttpDownload\(/);
  assert.match(nativeStats, /L"\/streakStats"/);
  assert.match(nativeStats, /ParseStatsJson/);
  assert.match(nativeStats, /StatsStore\(\)\.Publish/);
  assert.match(nativeStats, /kSuccessInterval/);
  assert.match(nativeStats, /kRetryInterval/);
});

test('the native path has no generated script or WebMessage protocol', () => {
  assert.doesNotMatch(nativeStats, /LR"JS|ExecuteScript|postMessage|chrome\?\.webview/);
  assert.doesNotMatch(nativeStats, /document_generation|auth_generation|request_id/);
  assert.doesNotMatch(nativeStats, /localStorage|sessionStorage/);
});
