import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeArtistRankSeries,
  selectTrendSeriesByLatestMetric,
} from '../public/spotify.js';

function series(artistKey, artistName, currentRank, points) {
  return { artistKey, artistName, currentRank, points };
}

test('Spotify playcount Top 10 ignores the separate artist roster rank', () => {
  const input = [
    series('rank-1', 'Roster #1', 1, [{ snapshot_date: '2026-09-29', total_delta: 100, top10_year_delta: 10 }]),
    series('rank-2', 'Roster #2', 2, [{ snapshot_date: '2026-09-29', total_delta: 200, top10_year_delta: 20 }]),
    series('rank-3', 'Roster #3', 3, [{ snapshot_date: '2026-09-29', total_delta: 300, top10_year_delta: 30 }]),
    series('rank-4', 'Roster #4', 4, [{ snapshot_date: '2026-09-29', total_delta: 400, top10_year_delta: 40 }]),
    series('rank-5', 'Roster #5', 5, [{ snapshot_date: '2026-09-29', total_delta: 500, top10_year_delta: 50 }]),
    series('rank-6', 'Roster #6', 6, [{ snapshot_date: '2026-09-29', total_delta: 600, top10_year_delta: 60 }]),
    series('rank-7', 'Roster #7', 7, [{ snapshot_date: '2026-09-29', total_delta: 700, top10_year_delta: 70 }]),
    series('rank-8', 'Roster #8', 8, [{ snapshot_date: '2026-09-29', total_delta: 800, top10_year_delta: 80 }]),
    series('rank-9', 'Roster #9', 9, [{ snapshot_date: '2026-09-29', total_delta: 900, top10_year_delta: 90 }]),
    series('rank-10', 'Roster #10', 10, [{ snapshot_date: '2026-09-29', total_delta: 1000, top10_year_delta: 100 }]),
    series('rank-11', 'Roster #11', 11, [{ snapshot_date: '2026-09-29', total_delta: 1100, top10_year_delta: 110 }]),
    series('sakurazaka46', '櫻坂46', 16, [{ snapshot_date: '2026-09-29', total_delta: 950, top10_year_delta: 115 }]),
  ];

  const totalTop = selectTrendSeriesByLatestMetric(input, 'total_delta', 10)
    .map((item) => item.artistKey);
  assert.equal(totalTop.includes('sakurazaka46'), true);
  assert.equal(totalTop.includes('rank-1'), false);
  assert.deepEqual(totalTop.slice(0, 3), ['rank-11', 'rank-10', 'sakurazaka46']);

  const yearTop = selectTrendSeriesByLatestMetric(input, 'top10_year_delta', 10)
    .map((item) => item.artistKey);
  assert.equal(yearTop.includes('sakurazaka46'), true);
  assert.equal(yearTop[0], 'sakurazaka46');
  assert.equal(yearTop.includes('rank-1'), false);
});

test('Spotify playcount Top 10 is ranked only from the newest snapshot date', () => {
  const input = [
    series('stale', 'Stale Artist', 1, [
      { snapshot_date: '2026-09-28', total_delta: 999999 },
    ]),
    series('current-a', 'Current A', 20, [
      { snapshot_date: '2026-09-28', total_delta: 1 },
      { snapshot_date: '2026-09-29', total_delta: 200 },
    ]),
    series('current-b', 'Current B', null, [
      { snapshot_date: '2026-09-29', total_delta: 100 },
    ]),
  ];

  assert.deepEqual(
    selectTrendSeriesByLatestMetric(input, 'total_delta', 10).map((item) => item.artistKey),
    ['current-a', 'current-b'],
  );
});

test('Spotify daily artist rank graph keeps only the three Sakamichi groups', () => {
  const trend = {
    rosterFirst: [{
      snapshot_date: '2026-09-29', artist_name: 'Roster First', current_rank: 1,
      total_delta: 1, top10_year_delta: 1,
    }],
    sakurazaka46: [{
      snapshot_date: '2026-09-29', artist_name: '櫻坂46', current_rank: 16,
      total_delta: 1, top10_year_delta: 1,
    }],
    nogizaka46: [{
      snapshot_date: '2026-09-29', artist_name: '乃木坂46', current_rank: 10,
      total_delta: 1, top10_year_delta: 1,
    }],
    hinatazaka46: [{
      snapshot_date: '2026-09-29', artist_name: '日向坂46', current_rank: 20,
      total_delta: 1, top10_year_delta: 1,
    }],
  };
  const chart = {
    days: [{
      chart_date: '2026-09-29',
      entries: [
        { artist_key: 'rosterFirst', artist_name: 'Roster First', rank: 1 },
        { artist_key: 'sakurazaka46', artist_name: '櫻坂46', rank: 12 },
        { artist_key: 'nogizaka46', artist_name: '乃木坂46', rank: 8 },
        { artist_key: 'hinatazaka46', artist_name: '日向坂46', rank: 18 },
      ],
    }],
  };

  const ranked = normalizeArtistRankSeries(chart, trend);
  assert.deepEqual(ranked.map((item) => item.artistKey), ['nogizaka46', 'sakurazaka46', 'hinatazaka46']);
  assert.deepEqual(ranked.map((item) => item.colorIndex), [0, 1, 2]);
});
