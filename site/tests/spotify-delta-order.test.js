import assert from 'node:assert/strict';
import test from 'node:test';

import { spotifyPayload } from '../functions/api/spotify-playcounts.js';

const artist = Object.freeze({ key: 'sakurazaka46', name: '櫻坂46' });

function row(trackId, name, playcount, delta) {
  return {
    artist_key: 'sakurazaka46',
    snapshot_date: '2026-09-28',
    track_id: trackId,
    name,
    playcount,
    delta,
    collected_at: 1_800_000_000_000,
    is_carried_forward: 0,
  };
}

test('Spotify detail is resorted by delta descending after duplicate titles are merged', () => {
  const payload = spotifyPayload(artist, [
    row('ban', 'BAN', 11_078_199, 2_940),
    row('jigou-single', '自業自得', 9_386_149, 3_100),
    row('return', '何歳の頃に戻りたいのか？', 9_755_592, 5_572),
    row('jigou-album', ' 自業自得　', 9_386_149, 3_991),
    row('unknown-delta', '未更新曲', 12_000_000, null),
  ]);

  assert.deepEqual(payload.tracks.map(({ name, delta }) => [name, delta]), [
    ['何歳の頃に戻りたいのか？', 5_572],
    ['自業自得', 3_991],
    ['BAN', 2_940],
    ['未更新曲', null],
  ]);
  assert.deepEqual(payload.tracks.map((track) => track.rank), [1, 2, 3, 4]);
});

test('Spotify detail uses cumulative playcount as the tie breaker for equal deltas', () => {
  const payload = spotifyPayload(artist, [
    row('lower', 'Lower', 5_000_000, 4_000),
    row('higher', 'Higher', 6_000_000, 4_000),
  ]);

  assert.deepEqual(payload.tracks.map((track) => track.track_id), ['higher', 'lower']);
});
