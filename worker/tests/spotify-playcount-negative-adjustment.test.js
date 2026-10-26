import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  countPlaycountRegressions,
  hasPlaycountAdvance,
} from '../src/spotify-playcount-collector.js';
import { spotifyReadModelAll } from '../../packages/sh-shared/spotify-read-model.mjs';

test('downward Spotify playcount adjustments remain detectable as published changes', () => {
  const previous = [
    { track_id: 'a', playcount: 100 },
    { track_id: 'b', playcount: 200 },
  ];
  const adjusted = [
    { track_id: 'a', playcount: 100 },
    { track_id: 'b', playcount: 198 },
  ];

  assert.equal(hasPlaycountAdvance(previous, adjusted), true);
  assert.equal(countPlaycountRegressions(previous, adjusted), 1);
});

test('zero-count regressions carry forward the prior total in the read model and graph', () => {
  const model = spotifyReadModelAll([
    {
      artist_key: 'nogizaka46', snapshot_date: '2026-10-24', track_id: 861,
      spotify_track_id: 'source-861', name: '設定温度', playcount: 0,
      delta: -2172726, collected_at: 1000, is_carried_forward: 0,
    },
    {
      artist_key: 'nogizaka46', snapshot_date: '2026-10-24', track_id: 862,
      spotify_track_id: 'source-862', name: '正常な曲', playcount: 100,
      delta: 50, collected_at: 1000, is_carried_forward: 0,
    },
  ], [{
    artist_key: 'nogizaka46', artist_name: '乃木坂46', snapshot_date: '2026-10-24',
    total_delta: -2172676, top10_delta: 50, top10_year_delta: 50,
  }], []);

  const group = model.groups.nogizaka46;
  const carried = group.tracks.find((track) => track.name === '設定温度');
  assert.equal(carried.playcount, 2172726);
  assert.equal(carried.delta, 0);
  assert.equal(carried.is_carried_forward, true);
  assert.equal(group.total_delta, 50);
  assert.equal(model.trend.nogizaka46[0].total_delta, 50);
});

test('daily finalization preserves genuine old-track decreases and applies new-release/zero safeguards', () => {
  const consumer = readFileSync(new URL('../src/spotify-playcount-consumer.js', import.meta.url), 'utf8');
  const finalizer = readFileSync(new URL('../src/spotify-playcount-daily-write.js', import.meta.url), 'utf8');

  assert.match(consumer, /spotifyDailyFinalizeStatement\(db, message, previousDate\)/);
  assert.match(consumer, /spotify_playcount_adjustment/);
  assert.doesNotMatch(consumer, /candidate snapshot regressed/);
  assert.match(finalizer, /playcount=0 AND previous_playcount>0/);
  assert.match(finalizer, /substr\(release_date,1,4\)=substr\(\?,1,4\)/);
});


test('unbaselined older tracks do not inflate the daily total with lifetime playcounts', () => {
  const model = spotifyReadModelAll([
    {
      artist_key: 'nogizaka46', snapshot_date: '2026-10-25', track_id: 861,
      spotify_track_id: 'source-861', name: 'First observed older song', playcount: 2369690,
      delta: null, collected_at: 1000, is_carried_forward: 0,
    },
    {
      artist_key: 'nogizaka46', snapshot_date: '2026-10-25', track_id: 862,
      spotify_track_id: 'source-862', name: 'Measured song', playcount: 39233571,
      delta: 8249, collected_at: 1000, is_carried_forward: 0,
    },
  ], [{
    artist_key: 'nogizaka46', artist_name: '乃木坂46', snapshot_date: '2026-10-25',
    total_delta: 8249, top10_delta: 8249, top10_year_delta: 8249,
  }], []);

  const group = model.groups.nogizaka46;
  assert.equal(group.tracks.find((track) => track.name === 'First observed older song').delta, null);
  assert.equal(group.total_delta, 8249);
  assert.equal(model.trend.nogizaka46.find((point) => point.snapshot_date === '2026-10-25').total_delta, 8249);
});
