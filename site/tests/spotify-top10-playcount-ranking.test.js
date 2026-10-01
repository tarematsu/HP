import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeArtistRankSeries } from '../public/spotify.js';

test('Spotify daily artist rank graph keeps only the three Sakamichi groups in Sakurazaka-first order', () => {
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
  assert.deepEqual(ranked.map((item) => item.artistKey), ['sakurazaka46', 'nogizaka46', 'hinatazaka46']);
  assert.deepEqual(ranked.map((item) => item.colorIndex), [0, 1, 2]);
});
