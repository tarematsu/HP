import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const mediaEntry = readFileSync(
  new URL('../../native/src/renderer_panels/media_section_base.inc', import.meta.url),
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

test('the compiled media entry is the integrated YouTube and TVer panel', () => {
  assert.match(mediaEntry, /HomePanelNativeMvPanel/);
  assert.match(mediaEntry, /kNativeMediaYoutubeUrl/);
  assert.doesNotMatch(mediaEntry, /kNativeMediaTverUrl|data:text\/html/);
  assert.doesNotMatch(mediaEntry, /#include "mv_section\.inc"/);
  assert.doesNotMatch(mediaEntry, /media_section_v2\.inc/);
});
