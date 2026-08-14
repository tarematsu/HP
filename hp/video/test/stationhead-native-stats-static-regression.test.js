import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const header = readFileSync(
  new URL('../../native/src/stationhead_native_stats.h', import.meta.url),
  'utf8',
);
const source = readFileSync(
  new URL('../../native/src/stationhead_native_stats.cpp', import.meta.url),
  'utf8',
);
const playback = readFileSync(
  new URL('../../native/src/sh_playback_resource_policy_fix.h', import.meta.url),
  'utf8',
);
const renderer = readFileSync(
  new URL('../../native/src/renderer_panel_state.cpp', import.meta.url),
  'utf8',
);
const panel = readFileSync(
  new URL('../../native/src/renderer_panels/media_section_v2.inc', import.meta.url),
  'utf8',
);

test('Stationhead statistics use one passive native implementation', () => {
  assert.equal(source.trim(), '#include "stationhead_native_stats.h"');
  assert.match(header, /AttachStationheadNativeStatsObserver/);
  assert.match(header, /add_WebResourceResponseReceived/);
  assert.match(header, /get_Response/);
  assert.match(header, /get_StatusCode/);
  assert.match(header, /GetContent/);
  assert.match(header, /ParseStationheadNativeStatsJson/);
  assert.match(header, /StationheadNativeStatsStore/);
});

test('playback attaches the passive response observer', () => {
  assert.match(
    playback,
    /AttachStationheadNativeStatsObserver\(webview, config\.channelId\)/,
  );
  assert.match(
    playback,
    /#define kStationheadDailyPlayStatsIntervalMs \(INT64_MAX \/ 2\)/,
  );
});

test('renderer consumes the native store directly', () => {
  assert.match(panel, /GlobalStationheadNativeStatsStore\(\)\.Snapshot\(\)/);
  assert.match(panel, /SummarizeStationheadDailyPlays\(nativeStats\.daily, nowMs\)/);
  assert.match(renderer, /GlobalStationheadNativeStatsStore\(\)\.Revision\(\)/);
  assert.match(renderer, /nativeStatsChanged/);
});
