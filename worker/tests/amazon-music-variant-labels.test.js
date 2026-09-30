import test from 'node:test';
import assert from 'node:assert/strict';

import { labelAmazonMusicVariants } from '../src/amazon-music-pipeline.js';

test('duplicate Amazon Music IDs keep the lower ID plain and mark later IDs as SE', () => {
  const rows = labelAmazonMusicVariants([
    { amazon_music_id: 'B0TRACK10', track_id: 42, title: '同名曲' },
    { amazon_music_id: 'B0TRACK02', track_id: 42, title: '同名曲' },
    { amazon_music_id: 'B0OTHER01', track_id: 43, title: '別の曲' },
  ]);
  const byId = new Map(rows.map((row) => [row.amazon_music_id, row.display_title]));

  assert.equal(byId.get('B0TRACK02'), '同名曲');
  assert.equal(byId.get('B0TRACK10'), '同名曲(SE)');
  assert.equal(byId.get('B0OTHER01'), '別の曲');
});

test('same title with different canonical tracks stays unmarked', () => {
  const rows = labelAmazonMusicVariants([
    { amazon_music_id: 'B0SAME001', track_id: 51, title: '同名曲' },
    { amazon_music_id: 'B0SAME002', track_id: 52, title: '同名曲' },
  ]);

  assert.deepEqual(rows.map((row) => row.display_title), ['同名曲', '同名曲']);
});

test('unknown titles are not marked as SE', () => {
  const rows = labelAmazonMusicVariants([
    { amazon_music_id: 'UNKNOWN1', title: null },
    { amazon_music_id: 'UNKNOWN2', title: null },
  ]);

  assert.deepEqual(rows.map((row) => row.display_title), ['曲名不明', '曲名不明']);
});
