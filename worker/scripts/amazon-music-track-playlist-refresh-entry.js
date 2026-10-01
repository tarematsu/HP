import {
  AMAZON_MUSIC_TRACK_PLAYLIST_MODEL_KEY,
  collectAmazonMusicTrackPlaylists,
} from '../src/amazon-music-track-playlist-collector.js';
import { amazonMusicTrackPlaylistFetch } from '../src/amazon-music-track-playlist-fetch.js';

async function readJson(r2, key) {
  const object = await r2.get(key);
  if (!object) return null;
  if (typeof object.json === 'function') return object.json();
  return JSON.parse(await object.text());
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/refresh') return new Response('Not found', { status: 404 });

    const result = await collectAmazonMusicTrackPlaylists(env, Date.now(), amazonMusicTrackPlaylistFetch);
    const model = await readJson(env.PAGES_RESPONSE_R2, AMAZON_MUSIC_TRACK_PLAYLIST_MODEL_KEY);
    const tracks = Array.isArray(model?.tracks) ? model.tracks : [];
    const withPlaylists = tracks.filter((track) => Number(track?.playlist_count) > 0);
    const memberships = withPlaylists.reduce((sum, track) => sum + Number(track?.playlist_count || 0), 0);
    const samples = withPlaylists.slice(0, 8).map((track) => ({
      group_name: track.group_name,
      title: track.title,
      amazon_music_id: track.amazon_music_id,
      playlist_count: track.playlist_count,
      playlists: (Array.isArray(track.playlists) ? track.playlists : []).slice(0, 5).map((playlist) => ({
        playlist_id: playlist.playlist_id,
        name: playlist.name,
        curator: playlist.curator,
        url: playlist.url,
      })),
    }));
    const errorSamples = tracks
      .filter((track) => track?.status === 'error' && track?.error)
      .slice(0, 12)
      .map((track) => ({
        group_name: track.group_name,
        title: track.title,
        amazon_music_id: track.amazon_music_id,
        error: track.error,
      }));

    return Response.json({
      ...result,
      playlist_tracks: withPlaylists.length,
      playlist_memberships: memberships,
      samples,
      error_samples: errorSamples,
    }, {
      headers: { 'cache-control': 'no-store' },
    });
  },
};
