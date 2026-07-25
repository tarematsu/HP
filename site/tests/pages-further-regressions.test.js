import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  countSakurazakaMissingSummaries,
  mergeSakurazakaSeriesRows,
} from '../functions/api/sakurazaka46jp.js';
import { inferArtistFromDisplayTitle } from '../functions/lib/playback.js';
import {
  currentJstWeekRange,
  inclusivePresetStart,
  jstDate,
} from '../public/history/history-date-utils.js';
import {
  aggregateCompleteTrackRows,
  normalizeTrackRows,
  summarizeCompleteTrackRows,
} from '../public/history/history-track-view.js';

test('playback artist inference accepts artist-first and title-first display labels', () => {
  assert.equal(inferArtistFromDisplayTitle('Song — Artist', 'Song'), 'Artist');
  assert.equal(inferArtistFromDisplayTitle('Artist — Song', 'Song'), 'Artist');
  assert.equal(inferArtistFromDisplayTitle('JPABCDEF123 — Song', 'Song'), null);
});

test('track summaries aggregate the same song across complete dates', () => {
  const rows = [
    { play_date: '2026-07-20', track_key: 'a', play_count: 3, period_complete: true },
    { play_date: '2026-07-21', track_key: 'a', play_count: 4, play_count_excluded: false },
    { play_date: '2026-07-20', track_key: 'b', play_count: 2, play_count_excluded: false },
    { play_date: '2026-07-22', track_key: 'c', play_count: 99, play_count_excluded: true },
  ];
  assert.deepEqual(summarizeCompleteTrackRows(rows), { days: 2, tracks: 2, total: 9, maximum: 7 });
  assert.deepEqual(aggregateCompleteTrackRows(rows).map((row) => [row.identity, row.play_count]), [
    ['a', 7],
    ['b', 2],
  ]);
});

test('track aggregation joins rows that expose different identifiers for the same song', () => {
  const rows = [
    { play_date: '2026-07-20', track_key: 'legacy-a', spotify_id: 'spotify-a', title: 'Song', play_count: 2 },
    { play_date: '2026-07-21', spotify_id: 'spotify-a', display_title: 'Song', play_count: 3 },
  ];
  const aggregate = aggregateCompleteTrackRows(rows);
  assert.equal(aggregate.length, 1);
  assert.equal(aggregate[0].play_count, 5);
});

test('track rows recover whitespace-only titles and artists before rendering or caching', () => {
  const rows = normalizeTrackRows([{
    title: '   ',
    display_title: 'Recovered title',
    artist: ' ',
    raw_artist: 'Recovered artist',
  }]);
  assert.equal(rows[0].title, 'Recovered title');
  assert.equal(rows[0].artist, 'Recovered artist');
});

test('JST week boundaries and inclusive presets do not depend on the UTC calendar day', () => {
  const mondayAfterMidnightJst = Date.parse('2026-07-26T15:30:00Z');
  assert.equal(jstDate(0, mondayAfterMidnightJst), '2026-07-27');
  assert.deepEqual(currentJstWeekRange(mondayAfterMidnightJst), {
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

test('history patches cover session caches, full-row rankings and shared JST dates', () => {
  const entry = readFileSync(new URL('../public/history/history-main.js', import.meta.url), 'utf8');
  const guard = readFileSync(new URL('../public/history/history-request-guard.js', import.meta.url), 'utf8');
  const fixes = readFileSync(new URL('../public/history/history-page-fixes.js', import.meta.url), 'utf8');
  const likes = readFileSync(new URL('../public/history/history-likes.js', import.meta.url), 'utf8');
  const likesPage = readFileSync(new URL('../public/history/likes/index.html', import.meta.url), 'utf8');
  assert.match(entry, /JST_OFFSET_MS/);
  assert.match(entry, /history:runtime-ready/);
  assert.match(guard, /TRACK_CACHE_PREFIX/);
  assert.match(guard, /Object\.defineProperty\(prototype, 'getItem'/);
  assert.doesNotMatch(guard, /#tracks' \|\| !trackRows\.length/);
  assert.match(fixes, /aggregateCompleteTrackRows/);
  assert.match(fixes, /inclusivePresetStart/);
  assert.match(likes, /currentJstWeekRange/);
  assert.match(likes, /completeTrackRows\(result\.data\.rows\)/);
  assert.match(likes, /else load\(\)/);
  assert.match(likesPage, /<script type="module" src="\/history\/history-likes\.js"><\/script>/);
});

test('dashboard image retries use canonical URLs and successful refreshes clear stale errors', () => {
  const source = readFileSync(new URL('../public/dashboard-metrics.js', import.meta.url), 'utf8');
  assert.match(source, /IMAGE_RETRY_DELAYS/);
  assert.match(source, /canonicalImageSource/);
  assert.match(source, /image\.dataset\.lastSource = source/);
  assert.match(source, /status\.hidden = true/);
});
