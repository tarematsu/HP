import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  currentUtcWeekRange,
  inclusivePresetStart,
} from '../public/history/history-page-fixes.js';
import {
  countSakurazakaMissingSummaries,
  mergeSakurazakaSeriesRows,
} from '../functions/api/sakurazaka46jp.js';

const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('history runtime restores only archive modes and keeps no track-history controls', () => {
  const entry = source('../public/history/history-main.js');
  const history = source('../public/history/history-lite.js');
  const fixes = source('../public/history/history-page-fixes.js');

  assert.match(entry, /history:runtime-ready/);
  assert.doesNotMatch(entry, /legacyHistoryRoute|trackDate|trackWeekMode|'tracks'/);
  assert.doesNotMatch(history, /trackDate|trackWeekMode|track-controls|weekMode/);
  assert.doesNotMatch(fixes, /trackDate|trackWeekMode|track-controls|weekMode/);
});

test('history archive presets use UTC calendar ranges', () => {
  const mondayUtc = new Date('2026-07-27T12:00:00Z');
  assert.deepEqual(currentUtcWeekRange(mondayUtc), {
    from: '2026-07-27',
    to: '2026-07-27',
  });
  assert.equal(inclusivePresetStart('2026-07-30', 30), '2026-07-01');
});

test('official series keeps distinct nearby events and reports missing summaries from minute facts', () => {
  const primary = [{
    event_name: 'Event A',
    started_at: 1_000_000,
    samples: [{ elapsed: 0, listener: 100, sourceSamples: 1 }],
  }];
  const fallback = [{
    event_name: 'Event B',
    started_at: 1_000_000 + 5 * 60_000,
    samples: [{ elapsed: 0, listener: 110, sourceSamples: 1 }],
  }];
  assert.equal(mergeSakurazakaSeriesRows(primary, fallback).length, 2);
  assert.equal(countSakurazakaMissingSummaries([
    { samples: [{ elapsed: 0, listener: 1 }] },
    { samples: [] },
    { samples: [{ elapsed: 0, listener: 2 }] },
  ], 4), 2);
});

test('active Pages archive runtimes are UTC-only except the official-party today highlight', () => {
  const entry = readFileSync(new URL('../public/history/history-main.js', import.meta.url), 'utf8');
  const guard = readFileSync(new URL('../public/history/history-request-guard.js', import.meta.url), 'utf8');
  const fixes = readFileSync(new URL('../public/history/history-page-fixes.js', import.meta.url), 'utf8');
  const history = readFileSync(new URL('../public/history/history-lite.js', import.meta.url), 'utf8');
  const likes = readFileSync(new URL('../public/history/history-likes.js', import.meta.url), 'utf8');
  const broadcasts = readFileSync(new URL('../public/history/history-broadcasts.js', import.meta.url), 'utf8');
  const dashboard = readFileSync(new URL('../public/dashboard-client.js', import.meta.url), 'utf8');
  const mainPage = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const tabs = readFileSync(new URL('../public/dashboard-tabs.js', import.meta.url), 'utf8');
  const utcArchiveSources = [entry, guard, fixes, history, likes].join('\n');

  assert.match(entry, /history:runtime-ready/);
  assert.doesNotMatch(entry, /trackDate|trackWeekMode|'tracks'|legacyHistoryRoute/);
  assert.doesNotMatch(guard, /TRACK_CACHE_PREFIX|\/api\/track-history|history:track-rows/);
  assert.doesNotMatch(fixes, /aggregateCompleteTrackRows|再生数ランキング|history:track-rows/);
  assert.match(fixes, /applyUtcPreset/);
  assert.match(fixes, /inclusivePresetStart/);
  assert.match(history, /timeZone: 'UTC'/);
  assert.match(history, /todayUtc/);
  assert.match(likes, /timeZone: 'UTC'/);
  assert.match(likes, /ranking_only=1/);
  assert.doesNotMatch(likes, /currentUtcWeekRange|completeTrackRows|week_play_count/);
  assert.match(likes, /else if \(!el\('likesView'\)\.hidden\) load\(\)/);
  assert.match(broadcasts, /timeZone: 'UTC'/);
  assert.match(broadcasts, /timeZone: 'Asia\/Tokyo'/);
  assert.match(broadcasts, /isTodayEvent/);
  assert.match(dashboard, /timeZone: 'UTC'/);
  assert.match(dashboard, /最終取得 \$\{safeDate\(latest\.observed_at\)\} UTC/);
  assert.match(mainPage, /id="likesView"/);
  assert.match(tabs, /import\('\/history\/history-likes\.js'\)/);
  assert.doesNotMatch(mainPage, /href="\/history/);
  assert.doesNotMatch(utcArchiveSources, /Asia\/Tokyo|JST_OFFSET_MS|jstDate|todayJst|currentJstWeekRange|applyJstPreset/);
});

test('dashboard image retries use canonical URLs and successful refreshes clear stale errors', () => {
  const source = readFileSync(new URL('../public/dashboard-metrics.js', import.meta.url), 'utf8');
  assert.match(source, /IMAGE_RETRY_DELAYS/);
  assert.match(source, /canonicalImageSource/);
  assert.match(source, /image\.dataset\.lastSource = source/);
  assert.match(source, /status\.hidden = true/);
});
