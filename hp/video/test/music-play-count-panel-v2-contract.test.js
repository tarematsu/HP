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

test('the public header stays a narrow renderer facade', () => {
  assert.match(nativeStatsHeader, /void AttachStationheadNativeStats/);
  assert.match(nativeStatsHeader, /class StationheadNativeStatsAccess final/);
  assert.doesNotMatch(
    nativeStatsHeader,
    /WinHttpDownload|WebResourceRequested|JsonObject::Parse/,
  );
});

test('one native worker actively owns streakStats retrieval', () => {
  assert.match(nativeStats, /GetDevToolsProtocolEventReceiver/);
  assert.match(nativeStats, /Network\.responseReceived/);
  assert.match(nativeStats, /class NativeStatsClient/);
  assert.match(nativeStats, /std::thread\(\[this\] \{ WorkerLoop\(\); \}\)\.detach\(\)/);
  assert.match(nativeStats, /WinHttpDownload\(/);
  assert.match(nativeStats, /L"\/streakStats"/);
  assert.match(nativeStats, /ParseStatsJson/);
  assert.match(nativeStats, /StatsStore\(\)\.Publish/);
  assert.match(nativeStats, /kSuccessInterval/);
  assert.match(nativeStats, /kRetryInterval/);

  assert.doesNotMatch(nativeStats, /add_WebResourceResponseReceived/);
  assert.doesNotMatch(nativeStats, /add_WebResourceRequested/);
  assert.doesNotMatch(nativeStats, /Network\.requestWillBeSent|Network\.loadingFinished|Network\.getResponseBody/);
  assert.doesNotMatch(nativeStats, /requestId|PendingRequest/);
});

test('the native path does not patch page JavaScript or use a WebMessage stats protocol', () => {
  assert.doesNotMatch(nativeStats, /LR"JS|ExecuteScript|postMessage|chrome\?\.webview/);
  assert.doesNotMatch(nativeStats, /document_generation|auth_generation/);
  assert.doesNotMatch(nativeStats, /localStorage|sessionStorage/);
});
