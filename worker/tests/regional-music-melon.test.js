import assert from 'node:assert/strict';
import test from 'node:test';

import {
  findMelonArtistId,
  parseMelonFollowers,
  parseMelonPlaylistEntries,
} from '../src/regional-music-melon.js';

test('Melon discovers artist ids and fan counts', () => {
  assert.equal(
    findMelonArtistId('<a href="javascript:melon.link.goArtistDetail(\'12345\');">Nogizaka46</a>', ['乃木坂46', 'Nogizaka46']),
    '12345',
  );
  assert.equal(parseMelonFollowers('<span>팬맺기 1,234</span>'), 1234);
});

test('Melon playlist parser keeps only target artists', () => {
  const html = `
    <table><tbody>
      <tr data-song-no="111"><td class="rank">5</td><td class="rank01"><a>Girls' Rule</a></td><td>Nogizaka46</td></tr>
      <tr data-song-no="222"><td class="rank">6</td><td class="rank01"><a>Other</a></td><td>Other Artist</td></tr>
      <tr data-song-no="333"><td class="rank">43</td><td class="rank01"><a>走れ! Bicycle</a></td><td>乃木坂46</td></tr>
    </tbody></table>`;
  assert.deepEqual(parseMelonPlaylistEntries(html), [
    { track_id: '111', canonical_artist: 'nogizaka46', title: "Girls' Rule", position: 5 },
    { track_id: '333', canonical_artist: 'nogizaka46', title: '走れ! Bicycle', position: 43 },
  ]);
});
