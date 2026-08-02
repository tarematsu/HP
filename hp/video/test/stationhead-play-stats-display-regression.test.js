import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const mediaSection = readFileSync(
  new URL('../../native/src/renderer_panels/media_section_v2.inc', import.meta.url),
  'utf8',
);
const mediaEntry = readFileSync(
  new URL('../../native/src/renderer_panels/media_section.inc', import.meta.url),
  'utf8',
);
const fixture = JSON.parse(readFileSync(
  new URL('./fixtures/stationhead-streak-stats-2026-08-02.json', import.meta.url),
  'utf8',
));

function utcDay(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function summary(points, now) {
  const values = new Map(points.map(point => [utcDay(point.ts), point.val]));
  const today = new Date(now);
  const todayKey = today.toISOString().slice(0, 10);
  const yesterday = new Date(today);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const day = today.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const thisMonday = new Date(today);
  thisMonday.setUTCDate(thisMonday.getUTCDate() + mondayOffset);
  thisMonday.setUTCHours(0, 0, 0, 0);
  const lastMonday = new Date(thisMonday);
  lastMonday.setUTCDate(lastMonday.getUTCDate() - 7);

  let thisWeek = 0;
  let lastWeek = 0;
  for (const point of points) {
    if (point.ts >= thisMonday.getTime() && point.ts <= now) thisWeek += point.val;
    if (point.ts >= lastMonday.getTime() && point.ts < thisMonday.getTime()) {
      lastWeek += point.val;
    }
  }
  return {
    today: values.get(todayKey) ?? -1,
    yesterday: values.get(yesterday.toISOString().slice(0, 10)) ?? -1,
    thisWeek,
    lastWeek,
  };
}

test('captured API fixture produces the expected UTC period totals', () => {
  const result = summary(
    fixture.payload.chart_data,
    Date.parse('2026-08-02T00:20:00.000Z'),
  );
  assert.deepEqual(result, {
    today: 3,
    yesterday: 512,
    thisWeek: 3459,
    lastWeek: 4982,
  });
});

test('the legacy media entry delegates to the rebuilt panel', () => {
  assert.match(mediaEntry, /#include "media_section_v2\.inc"/);
});

test('five play-count metrics own fixed cells', () => {
  assert.match(
    mediaSection,
    /kPlayMetricLabels\{[\s\S]*L"直近1時間"[\s\S]*L"本日"[\s\S]*L"昨日"[\s\S]*L"今週"[\s\S]*L"先週"/,
  );
  assert.match(mediaSection, /std::array<std::wstring, 5> playMetricValues/);
  assert.match(mediaSection, /usableMetricWidth \* index \/ 5/);
  assert.match(mediaSection, /DrawWidgetCard\(dc, cell, kWidgetSurfaceAlt/);
  assert.match(mediaSection, /playValueText\(summary\.today\)/);
  assert.match(mediaSection, /playValueText\(summary\.lastWeek\)/);
});

test('renderer reads the native response store directly', () => {
  assert.match(
    mediaSection,
    /GlobalStationheadNativeStatsStore\(\)\.Snapshot\(\)/,
  );
  assert.match(mediaSection, /nativeStats\.daily/);
  assert.match(mediaSection, /nativeStats\.recentHour/);
  assert.doesNotMatch(mediaSection, /dailyPlayCounts/);
  assert.doesNotMatch(mediaSection, /dailyPlayStatsServerDateAt/);
  assert.doesNotMatch(mediaSection, /statsDocumentGeneration/);
  assert.doesNotMatch(mediaSection, /statsAuthGeneration/);
});

test('unavailable and stale values remain explicit', () => {
  assert.match(
    mediaSection,
    /value >= 0\s*\?\s*std::to_wstring\(value\)\s*:\s*std::wstring\(L"--"\)/,
  );
  assert.match(mediaSection, /kDailyPlayStatsStaleAfterMs = 15 \* 60'000/);
  assert.match(mediaSection, /statsStale\s*\?\s*kWidgetWarning/);
});
