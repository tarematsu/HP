import { loadMusicServicePlaylists } from './music-service-playlists.js?v=20261004.1';

export function loadAppleMusicPlaylistMemberships(options = {}) {
  return loadMusicServicePlaylists('apple', options);
}
