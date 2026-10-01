import test from 'node:test';
import assert from 'node:assert/strict';
import { findGenieArtistId, extractGenieTrackIds, parseGenieTrackMetrics } from '../src/regional-music-genie.js';
import { parseJioSaavnTracks, jioSaavnSongSearchUrl } from '../src/regional-music-jiosaavn.js';
import { pageRepresentsArtist } from '../src/regional-music-fungjai.js';

test('Genie recognizes current onclick links and rejects other artists', () => {
  const html = `<a onclick="fnViewArtist('82665327')">Giga &amp; Sakurazaka46</a><a href="#" onclick="fnViewArtist('80988607');return false;">Sakurazaka46</a>`;
  assert.equal(findGenieArtistId(html, ['Sakurazaka46']), '80988607');
  assert.deepEqual(extractGenieTrackIds(`<a onclick="fnViewSongInfo('109816172')">Song</a><a href="songInfo?xgnm=109816172">Song</a>`), ['109816172']);
});
test('JioSaavn reads nested primary artist identity without accepting unrelated songs', () => {
  const song = { id: 'song1', title: 'Song', more_info: { album: 'Album', artistMap: { primary_artists: [{ id:'9095179', name:'Sakurazaka46' }] } } };
  assert.equal(parseJioSaavnTracks({ songs: { data: [song] } }, ['Sakurazaka46'], '9095179')[0].album_name, 'Album');
  assert.deepEqual(parseJioSaavnTracks({ results:[song] }, ['Nogizaka46'], 'different'), []);
  assert.equal(new URL(jioSaavnSongSearchUrl('Sakurazaka46')).searchParams.get('query'), 'Sakurazaka46');
});
test('Fungjai does not identify an artist from a challenge script URL', () => {
  assert.equal(pageRepresentsArtist('<title>One moment, please...</title><script>location="/artists/sakurazaka46"</script>', ['Sakurazaka46']), false);
  assert.equal(pageRepresentsArtist('<h1>Sakurazaka46</h1>', ['Sakurazaka46']), true);
});

import { parseKugouArtistPage, parseKugouSearchTracks } from '../src/regional-music-kugou.js';
test('Kugou public artist catalog verifies profile and exact collaboration membership', () => {
  const songs = [{ hash:'abc', songname:'Song', singername:'乃木坂46、櫻坂46、日向坂46' }, { hash:'bad', singername:'Sakurazaka46 Cover' }];
  const html = `<div class="mbx"><a>歌手</a> &gt; 櫻坂46</div><script>var homeSongs = ${JSON.stringify(songs)};</script>`;
  assert.equal(parseKugouArtistPage(html, ['櫻坂46','Sakurazaka46']).length, 1);
  assert.deepEqual(parseKugouArtistPage(html, ['Nogizaka46']), []);
  assert.deepEqual(parseKugouSearchTracks({ data:{info:[songs[1]]} }, ['Sakurazaka46']), []);
});

test('Genie reads listener and play labels supplied as image alt text', () => {
  assert.deepEqual(parseGenieTrackMetrics('<p>35</p><img alt="전체 청취자수"><p>672</p><img alt="전체 재생수"><div>좋아요! 9</div>'), {likes:9,listeners:35,plays:672});
});

import { qqSingerTracksUrl, parseQqSingerTracks } from '../src/regional-music-qq.js';
test('QQ uses the current public catalog module and reads its songList', () => {
  const url = new URL(qqSingerTracksUrl('mid1'));
  assert.equal(url.hostname, 'u.y.qq.com');
  assert.equal(JSON.parse(url.searchParams.get('data')).req_1.param.singerMid, 'mid1');
  const payload = { req_1:{data:{songList:[{songInfo:{mid:'song1',name:'Song',singer:[{mid:'mid1',name:'Sakurazaka46'}]}}]}} };
  assert.equal(parseQqSingerTracks(payload, 'mid1', ['Sakurazaka46'])[0].track_id, 'song1');
});

import { validateNeteaseResponse } from '../src/regional-music-netease.js';
import { gaanaArtistSearchUrl, gaanaArtistTracksUrl } from '../src/regional-music-gaana.js';
test('NetEase login/access errors cannot be treated as missing artists', () => {
  assert.throws(() => validateNeteaseResponse({code:301}), /rejected.*301/);
  assert.throws(() => validateNeteaseResponse({code:460}), /rejected.*460/);
  assert.equal(validateNeteaseResponse({code:200}).code, 200);
});
test('Gaana uses routes published by the current official web client', () => {
  const search = new URL(gaanaArtistSearchUrl('Sakurazaka46'));
  assert.equal(search.hostname,'gsearch.gaana.com');
  assert.equal(search.searchParams.get('query'),'Sakurazaka46');
  assert.equal(new URL(gaanaArtistTracksUrl('123')).pathname,'/home/artist/tracks/123');
});
