import test from 'node:test';
import assert from 'node:assert/strict';
import { parseKugouArtistPage, parseKugouSearchTracks } from '../src/regional-music-kugou.js';
import { qqSingerTracksUrl, parseQqSingerTracks } from '../src/regional-music-qq.js';

test('Kugou public artist catalog verifies profile and exact collaboration membership', () => {
  const songs = [{ hash:'abc', songname:'Song', singername:'乃木坂46、櫻坂46、日向坂46' }, { hash:'bad', singername:'Sakurazaka46 Cover' }];
  const html = `<div class="mbx"><a>歌手</a> &gt; 櫻坂46</div><script>var homeSongs = ${JSON.stringify(songs)};</script>`;
  assert.equal(parseKugouArtistPage(html, ['櫻坂46','Sakurazaka46']).length, 1);
  assert.deepEqual(parseKugouArtistPage(html, ['Nogizaka46']), []);
  assert.deepEqual(parseKugouSearchTracks({ data:{info:[songs[1]]} }, ['Sakurazaka46']), []);
});

test('QQ uses the current public catalog module and reads its songList', () => {
  const url = new URL(qqSingerTracksUrl('mid1'));
  assert.equal(url.hostname, 'u.y.qq.com');
  assert.equal(JSON.parse(url.searchParams.get('data')).req_1.param.singerMid, 'mid1');
  const payload = { req_1:{data:{songList:[{songInfo:{mid:'song1',name:'Song',singer:[{mid:'mid1',name:'Sakurazaka46'}]}}]}} };
  assert.equal(parseQqSingerTracks(payload, 'mid1', ['Sakurazaka46'])[0].track_id, 'song1');
});
