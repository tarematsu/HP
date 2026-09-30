import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { addRankChanges } from '../functions/api/amazon-music.js';

const shell = readFileSync(new URL('../public/amazon-music-shell.js', import.meta.url), 'utf8');
const runtime = readFileSync(new URL('../public/amazon-music.js', import.meta.url), 'utf8');

test('Amazon Music rank change compares only with the exact previous calendar day', () => {
  const payload = addRankChanges({
    snapshot_date: '2026-10-01',
    tracks: [
      { amazon_music_id: 'UP', amazon_rank: 200 },
      { amazon_music_id: 'DOWN', amazon_rank: 150 },
      { amazon_music_id: 'SAME', amazon_rank: 80 },
      { amazon_music_id: 'NEW', amazon_rank: 20 },
    ],
    history: [
      { snapshot_date: '2026-09-29', tracks: [{ amazon_music_id: 'NEW', amazon_rank: 999 }] },
      {
        snapshot_date: '2026-09-30',
        tracks: [
          { amazon_music_id: 'UP', amazon_rank: 320 },
          { amazon_music_id: 'DOWN', amazon_rank: 100 },
          { amazon_music_id: 'SAME', amazon_rank: 80 },
        ],
      },
    ],
  });
  const byId = new Map(payload.tracks.map((track) => [track.amazon_music_id, track.rank_change]));

  assert.equal(byId.get('UP'), 120);
  assert.equal(byId.get('DOWN'), -50);
  assert.equal(byId.get('SAME'), 0);
  assert.equal(byId.get('NEW'), null);
});

test('Amazon Music table exposes the previous-day column and signed rank change', () => {
  assert.match(shell, /<th>前日比<\/th>/);
  assert.match(runtime, /track\?\.rank_change/);
  assert.match(runtime, /`\+\$\{numberFormat\.format\(delta\)\}`/);
});
