import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const panel = readFileSync(
  new URL('../../native/src/renderer_panels/media_section.inc', import.meta.url),
  'utf8',
);
const policy = readFileSync(
  new URL('../../native/src/sh_july19_stats_policy_fix.h', import.meta.url),
  'utf8',
);

test('Music panel reads play counts from StationheadStatus', () => {
  assert.match(panel, /nativeStationhead_\.dailyPlayCounts/);
  assert.match(panel, /nativeStationhead_\.dailyPlayStatsUpdatedAt/);
  assert.match(panel, /RecentStationheadPlayIncrease\(nativeStationheadPlayHistory_\)/);
  assert.match(panel, /SummarizeStationheadDailyPlays\(\s*nativeStationhead_\.dailyPlayCounts, nowMs\)/);
  assert.doesNotMatch(panel, /GlobalStationheadNativeStatsStore|media_section_v2\.inc/);
});

test('all requested play-count periods remain visible', () => {
  for (const label of ['直近1時間', '本日', '昨日', '今週', '先週']) {
    assert.match(panel, new RegExp(label));
  }
  assert.match(panel, /L"--"/);
  assert.match(panel, /DT_RIGHT \| DT_SINGLELINE/);
});

test('pre-368 Primary WebView owns the active stats request', () => {
  assert.match(policy, /StationheadPre368ApiPlayStatsScript/);
  assert.match(policy, /window\.__homepanelStationheadAuthHeaders/);
  assert.match(policy, /credentials: 'include'/);
  assert.match(policy, /\/streakStats/);
  assert.match(policy, /10 \* 60 \* 1000/);
  assert.doesNotMatch(policy, /PublishStationheadNativeStatsMessage|AttachStationheadNativeStats|WinHttpDownload/);
});
