import test from 'node:test';
import assert from 'node:assert/strict';

import { amazonMusicDisplayTitleMap } from '../public/amazon-music.js';

test('duplicate Amazon Music catalog IDs keep the lower ID plain and mark later IDs as SE', () => {
  const titles = amazonMusicDisplayTitleMap({
    tracks: [
      { amazon_music_id: 'B0TRACK10', track_id: 42, title: '同名曲' },
      { amazon_music_id: 'B0TRACK2', track_id: 42, title: '同名曲' },
      { amazon_music_id: 'B0OTHER1', track_id: 43, title: '別の曲' },
    ],
  });

  assert.equal(titles.get('amazon:B0TRACK2'), '同名曲');
  assert.equal(titles.get('amazon:B0TRACK10'), '同名曲(SE)');
  assert.equal(titles.get('amazon:B0OTHER1'), '別の曲');
});

test('unknown titles are not treated as Special Edition duplicates', () => {
  const titles = amazonMusicDisplayTitleMap({
    tracks: [
      { amazon_music_id: 'UNKNOWN1', title: null },
      { amazon_music_id: 'UNKNOWN2', title: null },
    ],
  });

  assert.equal(titles.get('amazon:UNKNOWN1'), '曲名不明');
  assert.equal(titles.get('amazon:UNKNOWN2'), '曲名不明');
});
