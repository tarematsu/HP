import assert from 'node:assert/strict';
import test from 'node:test';

import {
  findMelonArtistId,
  melonArtistPopularSongsUrl,
  melonJpopChartUrl,
  melonJpopDailyChartUrl,
  parseMelonArtistTrackEntries,
  parseMelonFollowers,
  parseMelonJpopChartEntries,
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
    { track_id: '111', canonical_artist: 'nogizaka46', title: "Girls' Rule", album_name: null, position: 5 },
    { track_id: '333', canonical_artist: 'nogizaka46', title: '走れ! Bicycle', album_name: null, position: 43 },
  ]);
});

test('Melon popular-song URL requests provider popularity order', () => {
  assert.equal(
    melonArtistPopularSongsUrl('12345'),
    'https://mvod.melon.com/cds/artist/mobile2/artistsong_list.htm?artistId=12345&listType=A&orderBy=POPULAR_SONG_LIST&startIndex=1',
  );
});

test('Melon artist song rows preserve provider page order as popularity rank', () => {
  const html = `
    <ul>
      <li data-song-no="9001"><a href="javascript:goSongDetail('9001')">Track A</a></li>
      <li data-song-no="9002"><a href="javascript:goSongDetail('9002')">Track B</a></li>
      <li data-song-no="9002"><a href="javascript:goSongDetail('9002')">Track B duplicate control</a></li>
    </ul>`;
  assert.deepEqual(parseMelonArtistTrackEntries(html), [
    { track_id: '9001', title: 'Track A', album_name: null, position: 1 },
    { track_id: '9002', title: 'Track B', album_name: null, position: 2 },
  ]);
});

test('Melon J-pop charts use the official GN1900 daily weekly and monthly surfaces', () => {
  assert.equal(melonJpopDailyChartUrl(), 'https://www.melon.com/chart/day/index.htm?classCd=GN1900');
  assert.equal(melonJpopChartUrl('week'), 'https://www.melon.com/chart/week/index.htm?classCd=GN1900');
  assert.equal(melonJpopChartUrl('month'), 'https://www.melon.com/chart/month/index.htm?classCd=GN1900');
  assert.throws(() => melonJpopChartUrl('year'), /Unsupported Melon J-POP chart period/);
});

test('Melon J-pop chart keeps absolute chart positions only for the target groups', () => {
  const html = `
    <table><tbody>
      <tr class="lst50" data-song-no="1001">
        <td><span class="rank">7</span></td>
        <td><div class="ellipsis rank01"><a>Supernatural</a></div></td>
        <td><div class="ellipsis rank02"><a>NewJeans</a></div></td>
      </tr>
      <tr class="lst50" data-song-no="1002">
        <td><span class="rank">41</span></td>
        <td><div class="ellipsis rank01"><a>Sample Sakurazaka Song</a></div></td>
        <td><div class="ellipsis rank02"><a>Sakurazaka46</a></div></td>
        <td><div class="ellipsis rank03"><a>Sample Album</a></div></td>
      </tr>
      <tr class="lst100" data-song-no="1003">
        <td><span class="rank">73</span></td>
        <td><div class="ellipsis rank01"><a>Sample Nogizaka Song</a></div></td>
        <td><div class="ellipsis rank02"><a>乃木坂46</a></div></td>
      </tr>
    </tbody></table>`;
  assert.deepEqual(parseMelonJpopChartEntries(html), [
    {
      track_id: '1002',
      canonical_artist: 'sakurazaka46',
      title: 'Sample Sakurazaka Song',
      album_name: 'Sample Album',
      position: 41,
    },
    {
      track_id: '1003',
      canonical_artist: 'nogizaka46',
      title: 'Sample Nogizaka Song',
      album_name: null,
      position: 73,
    },
  ]);
});
