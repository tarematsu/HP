import { loadMusicServicePlaylists } from './music-service-playlists.js?v=20261001.1';

export function loadAppleMusicPlaylistMemberships({ force = false } = {}) {
  return loadMusicServicePlaylists('apple', { force });
}
