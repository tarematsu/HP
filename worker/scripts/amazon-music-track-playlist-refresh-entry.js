import {
  AMAZON_MUSIC_TRACK_PLAYLIST_MODEL_KEY,
  collectAmazonMusicTrackPlaylists,
} from '../src/amazon-music-track-playlist-collector.js';
import { amazonMusicTrackPlaylistFetch } from '../src/amazon-music-track-playlist-fetch.js';
import { publishAmazonMusicTrackPlaylistModel } from '../src/amazon-music-track-playlist-publisher.js';

async function readJson(r2, key) {
  const object = await r2.get(key);
  if (!object) return null;
  if (typeof object.json === 'function') return object.json();
  return JSON.parse(await object.text());
}

export function amazonPlaylistErrorSamplesForAttempt(tracks, observedAt) {
  const attemptAt = Number(observedAt);
  if (!Number.isFinite(attemptAt)) return [];
  return (Array.isArray(tracks) ? tracks : [])
    .filter((track) => (
      track?.status === 'error'
      && track?.error
      && Number(track?.last_attempt_at) === attemptAt
    ))
    .map((track) => ({
      group_name: track.group_name,
      title: track.title,
      amazon_music_id: track.amazon_music_id,
      error: track.error,
    }));
}

export function isAmazonPlaylistUpstreamUnavailable(result, batchErrors) {
  const batchTracks = Number(result?.batch_tracks || 0);
  const succeeded = Number(result?.succeeded || 0);
  const failed = Number(result?.failed || 0);
  if (!(batchTracks > 0) || succeeded > 0 || failed !== batchTracks) return false;
  if (!Array.isArray(batchErrors) || batchErrors.length !== failed) return false;
  return batchErrors.every((sample) => (
    /Amazon Music \/api\/cosmicTrack\/showTrackDetailSeeMore failed with HTTP 5\d\d/i.test(String(sample?.error || ''))
  ));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/refresh') return new Response('Not found', { status: 404 });

    const observedAt = Date.now();
    const result = await collectAmazonMusicTrackPlaylists(env, observedAt, amazonMusicTrackPlaylistFetch);
    const published = await publishAmazonMusicTrackPlaylistModel(env, observedAt);
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
    const batchErrors = amazonPlaylistErrorSamplesForAttempt(tracks, observedAt);
    const errorSamples = batchErrors.slice(0, 12);
    const upstreamUnavailable = isAmazonPlaylistUpstreamUnavailable(result, batchErrors);

    return Response.json({
      ...result,
      public_model: published,
      playlist_tracks: withPlaylists.length,
      playlist_memberships: memberships,
      samples,
      error_samples: errorSamples,
      upstream_unavailable: upstreamUnavailable,
    }, {
      headers: { 'cache-control': 'no-store' },
    });
  },
};
