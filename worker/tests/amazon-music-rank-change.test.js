import test from 'node:test';
import assert from 'node:assert/strict';

import { addAmazonMusicRankChanges } from '../src/amazon-music-pipeline.js';

test('Amazon Music rank change compares only with the exact previous calendar day', () => {
  const rows = addAmazonMusicRankChanges([
    { amazon_music_id: 'UP', amazon_rank: 200 },
    { amazon_music_id: 'DOWN', amazon_rank: 150 },
    { amazon_music_id: 'SAME', amazon_rank: 80 },
    { amazon_music_id: 'NEW', amazon_rank: 20 },
  ], [
    { snapshot_date: '2026-09-29', tracks: [{ amazon_music_id: 'NEW', amazon_rank: 999 }] },
    {
      snapshot_date: '2026-09-30',
      tracks: [
        { amazon_music_id: 'UP', amazon_rank: 320 },
        { amazon_music_id: 'DOWN', amazon_rank: 100 },
        { amazon_music_id: 'SAME', amazon_rank: 80 },
      ],
    },
  ], '2026-10-01');
  const byId = new Map(rows.map((track) => [track.amazon_music_id, track.rank_change]));

  assert.equal(byId.get('UP'), 120);
  assert.equal(byId.get('DOWN'), -50);
  assert.equal(byId.get('SAME'), 0);
  assert.equal(byId.get('NEW'), null);
});

test('Amazon Music rank change is unavailable without the exact previous day', () => {
  const rows = addAmazonMusicRankChanges([
    { amazon_music_id: 'TRACK1', amazon_rank: 10 },
  ], [
    { snapshot_date: '2026-09-29', tracks: [{ amazon_music_id: 'TRACK1', amazon_rank: 30 }] },
  ], '2026-10-01');

  assert.equal(rows[0].rank_change, null);
});
