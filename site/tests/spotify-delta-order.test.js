import assert from 'node:assert/strict';
import test from 'node:test';

import { spotifyPayload } from '../../worker/src/pages-query-api-spotify-playcounts.js';

const artist = Object.freeze({ key: 'sakurazaka46', name: '櫻坂46' });

function row(trackId, spotifyTrackId, name, playcount, delta) {
  return {
    artist_key: 'sakurazaka46',
    snapshot_date: '2026-09-28',
    track_id: trackId,
    spotify_track_id: spotifyTrackId,
    name,
    playcount,
    delta,
    collected_at: 1_800_000_000_000,
    is_carried_forward: 0,
  };
}

test('Spotify detail uses sh_tracks.id to merge editions and sorts by delta descending', () => {
  const payload = spotifyPayload(artist, [
    row(101, 'ban', 'BAN', 11_078_199, 2_940),
    row(102, 'jigou-single', '自業自得', 9_386_149, 3_100),
    row(103, 'return', '何歳の頃に戻りたいのか？', 9_755_592, 5_572),
    row(102, 'jigou-album', ' 自業自得　', 9_386_149, 3_991),
    row(104, 'unknown-delta', '未更新曲', 12_000_000, null),
  ]);

  assert.deepEqual(payload.tracks.map(({ track_id, name, delta }) => [track_id, name, delta]), [
    [103, '何歳の頃に戻りたいのか？', 5_572],
    [102, '自業自得', 3_991],
    [101, 'BAN', 2_940],
    [104, '未更新曲', null],
  ]);
  assert.deepEqual(payload.tracks.map((track) => track.rank), [1, 2, 3, 4]);
  assert.equal(payload.unresolved_track_count, 0);
});

test('Spotify detail uses cumulative playcount as the tie breaker for equal deltas', () => {
  const payload = spotifyPayload(artist, [
    row(201, 'lower', 'Lower', 5_000_000, 4_000),
    row(202, 'higher', 'Higher', 6_000_000, 4_000),
  ]);

  assert.deepEqual(payload.tracks.map((track) => track.track_id), [202, 201]);
  assert.deepEqual(payload.tracks.map((track) => track.spotify_track_id), ['higher', 'lower']);
});

test('Spotify unresolved sources never masquerade as canonical track ids', () => {
  const payload = spotifyPayload(artist, [
    row(null, 'spotify-only', '未解決曲', 100, 10),
  ]);

  assert.equal(payload.tracks[0].track_id, null);
  assert.equal(payload.tracks[0].spotify_track_id, 'spotify-only');
  assert.equal(payload.unresolved_track_count, 1);
});

test('unknown first-observation deltas stay unknown while measured zero and negative deltas are preserved', () => {
  const payload = spotifyPayload(artist, [
    row(1, 'new', '新曲', 1200, null),
    row(2, 'zero', '更新なし', 9000, 0),
    row(3, 'negative', '補正', 8000, -5),
    row(4, 'edition-a', '別盤', 7000, null),
    row(4, 'edition-b', '別盤', 7000, 100),
  ]);
  assert.deepEqual(payload.tracks.map(track => [track.track_id, track.delta]), [
    [4, 100], [2, 0], [3, -5], [1, null],
  ]);
  assert.equal(payload.total_delta, 95);
});
