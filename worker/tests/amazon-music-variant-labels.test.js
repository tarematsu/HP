import test from 'node:test';
import assert from 'node:assert/strict';

import { labelAmazonMusicVariants } from '../src/amazon-music-pipeline.js';

test('Amazon Music display title appends the source album name', () => {
  const rows = labelAmazonMusicVariants([
    { amazon_music_id: 'B0TRACK01', track_id: 42, title: '同名曲', album: '通常盤' },
    { amazon_music_id: 'B0TRACK02', track_id: 42, title: '同名曲', album: 'Special Edition' },
    { amazon_music_id: 'B0OTHER01', track_id: 43, title: '別の曲', album: '別アルバム' },
  ]);
  const byId = new Map(rows.map((row) => [row.amazon_music_id, row.display_title]));

  assert.equal(byId.get('B0TRACK01'), '同名曲 (通常盤)');
  assert.equal(byId.get('B0TRACK02'), '同名曲 (Special Edition)');
  assert.equal(byId.get('B0OTHER01'), '別の曲 (別アルバム)');
});

test('OFF VOCAL track is not marked as SE and keeps its own album label', () => {
  const rows = labelAmazonMusicVariants([
    {
      amazon_music_id: 'B0OFFVOCAL',
      track_id: 52,
      title: '曲A -OFF VOCAL ver.-',
      album: '曲A',
    },
  ]);

  assert.equal(rows[0].display_title, '曲A -OFF VOCAL ver.- (曲A)');
});

test('missing album keeps the plain Amazon Music title', () => {
  const rows = labelAmazonMusicVariants([
    { amazon_music_id: 'B0NOALBUM', track_id: 51, title: '同名曲', album: null },
    { amazon_music_id: 'UNKNOWN1', title: null, album: null },
  ]);

  assert.deepEqual(rows.map((row) => row.display_title), ['同名曲', '曲名不明']);
});

test('album identical to title is not duplicated', () => {
  const rows = labelAmazonMusicVariants([
    { amazon_music_id: 'B0SAME', title: 'Same Title', album: 'Same Title' },
  ]);

  assert.equal(rows[0].display_title, 'Same Title');
});
