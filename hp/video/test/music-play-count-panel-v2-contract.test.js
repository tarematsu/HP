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
const header = readFileSync(
  new URL('../../native/src/stationhead_native_stats.h', import.meta.url),
  'utf8',
);
const source = readFileSync(
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
  assert.match(panel, /DT_RIGHT \| DT_SINGLELINE/);
  assert.match(panel, /L"--"/);
});

test('Music play counts use one native store and one observer implementation', () => {
  assert.equal(source.trim(), '#include "stationhead_native_stats.h"');
  assert.match(header, /AttachStationheadNativeStatsObserver/);
  assert.match(header, /ParseStationheadNativeStatsJson/);
  assert.match(header, /GlobalStationheadNativeStatsStore/);
  assert.match(panel, /GlobalStationheadNativeStatsStore\(\)\.Snapshot\(\)/);
});
