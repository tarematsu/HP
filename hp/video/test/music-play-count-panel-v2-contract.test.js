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
const activePolicy = readFileSync(
  new URL('../../native/src/sh_playback_resource_policy_fix.h', import.meta.url),
  'utf8',
);
const messagePolicy = readFileSync(
  new URL('../../native/src/sh_stats_webview_message_policy_fix.h', import.meta.url),
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

test('play-count acquisition uses PR48 authenticated Primary WebView polling', () => {
  assert.match(july19Policy, /StationheadJuly19AuthCaptureScript/);
  assert.match(july19Policy, /window\.fetch = function\(input, init\)/);
  assert.match(july19Policy, /NativeXhr\.prototype\.send = function/);
  assert.match(activePolicy, /StationheadPrimaryPlayStatsScript/);
  assert.match(activePolicy, /window\.__homepanelStationheadAuthHeaders/);
  assert.match(activePolicy, /if \(!headers\?\.authorization\)/);
  assert.match(activePolicy, /credentials: 'include'/);
  assert.match(activePolicy, /\/streakStats/);
  assert.match(activePolicy, /10 \* 60 \* 1000/);
});

test('the display path is StationheadStatus plus App play history', () => {
  assert.doesNotMatch(messagePolicy, /PublishStationheadNativeStatsMessage/);
  assert.match(panel, /nativeStationhead_\.dailyPlayCounts/);
  assert.match(panel, /nativeStationhead_\.dailyPlayStatsUpdatedAt/);
  assert.match(panel, /nativeStationheadPlayHistory_/);
  assert.doesNotMatch(panel, /GlobalStationheadNativeStatsStore\(\)\.Snapshot\(\)/);
});
