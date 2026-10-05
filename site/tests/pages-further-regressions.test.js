import { browserSource } from './helpers/dashboard-source.js';
import { dashboardRouterSource } from './helpers/dashboard-source.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  countSakurazakaMissingSummaries,
  mergeSakurazakaSeriesRows,
} from '../functions/api/sakurazaka46jp.js';
import { inferArtistFromDisplayTitle } from '../functions/lib/playback.js';
import { aggregatePlayed } from '../public/stationhead/played-tracks.js';
import { normalizePlayedRows } from '../public/stationhead/normalize.js';

test('playback artist inference accepts artist-first and title-first display labels', () => {
  assert.equal(inferArtistFromDisplayTitle('Song — Artist', 'Song'), 'Artist');
  assert.equal(inferArtistFromDisplayTitle('Artist — Song', 'Song'), 'Artist');
  assert.equal(inferArtistFromDisplayTitle('JPABCDEF123 — Song', 'Song'), null);
});

test('played tracks aggregate matching canonical songs across dates', () => {
  const tracks = aggregatePlayed([
    { track_id: 1, title: 'A', play_count: 3 },
    { track_id: 1, title: 'A', play_count: 4 },
    { track_id: 2, title: 'B', play_count: 2 },
  ]);
  assert.deepEqual(tracks.map(row => [row.track_id, row.play_count]), [[1, 7], [2, 2]]);
});

test('played tracks prefer canonical track IDs over provider variants', () => {
  const tracks = aggregatePlayed([
    { track_id: 1, spotify_id: 'old', play_count: 2 },
    { track_id: 1, spotify_id: 'new', play_count: 3 },
  ]);
  assert.equal(tracks.length, 1);
  assert.equal(tracks[0].play_count, 5);
});

test('played row normalization preserves fallback titles, artists and canonical identity', () => {
  const rows = normalizePlayedRows([{
    track_id: 42, display_title: 'Recovered title', artist_name: 'Recovered artist', count: 3,
  }]);
  assert.equal(rows[0].title, 'Recovered title');
  assert.equal(rows[0].artist, 'Recovered artist');
  assert.equal(rows[0].track_id, 42);
  assert.equal(rows[0].play_count, 3);
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

test('active Pages archive runtimes stay UTC except official-party display dates', () => {
  assert.match(browserSource('history/history-lite.js'),/timeZone: 'UTC'/); assert.match(browserSource('stationhead/likes.js'),/jstDateTime/); assert.match(browserSource('stationhead/view-utils.js'),/Asia\/Tokyo/);
});

test('dashboard artwork handling stays in the current runtime and successful refreshes clear stale errors', () => {
  const entry = readFileSync(new URL('../public/dashboard-metrics.js', import.meta.url), 'utf8');
  const source = browserSource('stationhead-channel.js');
  const fetchCache = readFileSync(new URL('../public/dashboard-fetch-cache.js', import.meta.url), 'utf8');
  assert.doesNotMatch(entry, /IMAGE_RETRY_DELAYS|MutationObserver/);
  assert.match(source, /track\?\.thumbnail_url/);
  assert.match(source, /image\.removeAttribute\('src'\)/);
  assert.match(source, /image\.hidden = true/);
  assert.doesNotMatch(source, /MutationObserver/);
  assert.match(fetchCache, /function clearTransientStatus/);
  assert.match(fetchCache, /node\.hidden = true/);
  assert.match(fetchCache, /clearTransientStatus\(\)/);
});
