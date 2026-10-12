import assert from 'node:assert/strict';
import test from 'node:test';

import { youtubeMusicPlaylistArtist } from '../public/youtube-music.js';

const playlist = { service_playlist_id: 'playlist-1', playlist_name: 'Top songs' };
const memberships = [
  { service_playlist_id: 'playlist-1', service_track_id: 's1' },
  { service_playlist_id: 'playlist-1', service_track_id: 's2' },
  { service_playlist_id: 'playlist-1', service_track_id: 'n1' },
  { service_playlist_id: 'playlist-2', service_track_id: 'n2' },
];
const tracks = [
  { service_track_id: 's1', canonical_artist: 'sakurazaka46' },
  { service_track_id: 's2', canonical_artist: 'sakurazaka46' },
  { service_track_id: 'n1', canonical_artist: 'nogizaka46' },
  { service_track_id: 'n2', canonical_artist: 'nogizaka46' },
];

test('YouTube Music playlist artist falls back to the dominant member-track artist', () => {
  assert.equal(youtubeMusicPlaylistArtist(playlist, memberships, tracks), 'sakurazaka46');
});

test('YouTube Music playlist artist prefers explicit playlist metadata', () => {
  assert.equal(youtubeMusicPlaylistArtist(
    { ...playlist, canonical_artist: 'hinatazaka46' },
    memberships,
    tracks,
  ), 'hinatazaka46');
});

test('YouTube Music playlist artist stays empty when member tracks have no artist', () => {
  assert.equal(youtubeMusicPlaylistArtist(playlist, memberships, []), '');
});
