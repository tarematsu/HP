import test from 'node:test';
import assert from 'node:assert/strict';

import { trackTitleMap } from '../public/amazon-music.js';

test('duplicate Amazon Music catalog IDs keep the lower ID plain and mark later IDs as SE', () => {
  const titles = trackTitleMap({
    tracks: [
      { amazon_music_id: 'B0TRACK10', track_id: 42, title: '同名曲' },
      { amazon_music_id: 'B0TRACK02', track_id: 42, title: '同名曲' },
      { amazon_music_id: 'B0OTHER01', track_id: 43, title: '別の曲' },
    ],
  });

  assert.equal(titles.get('amazon:B0TRACK02'), '同名曲');
  assert.equal(titles.get('amazon:B0TRACK10'), '同名曲(SE)');
  assert.equal(titles.get('amazon:B0OTHER01'), '別の曲');
});

test('same title with different canonical tracks is not treated as an SE duplicate', () => {
  const titles = trackTitleMap({
    tracks: [
      { amazon_music_id: 'B0SAME001', track_id: 51, title: '同名曲' },
      { amazon_music_id: 'B0SAME002', track_id: 52, title: '同名曲' },
    ],
  });

  assert.equal(titles.get('amazon:B0SAME001'), '同名曲');
  assert.equal(titles.get('amazon:B0SAME002'), '同名曲');
});

test('unknown titles are not treated as Special Edition duplicates', () => {
  const titles = trackTitleMap({
    tracks: [
      { amazon_music_id: 'UNKNOWN1', title: null },
      { amazon_music_id: 'UNKNOWN2', title: null },
    ],
  });

  assert.equal(titles.get('amazon:UNKNOWN1'), '曲名不明');
  assert.equal(titles.get('amazon:UNKNOWN2'), '曲名不明');
});
