import test from 'node:test';
import assert from 'node:assert/strict';
import { findGenieArtistId, extractGenieTrackIds } from '../src/regional-music-genie.js';
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
