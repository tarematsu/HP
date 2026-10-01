import assert from 'node:assert/strict';
import test from 'node:test';

import {
  amazonPlaylistErrorSamplesForAttempt,
  isAmazonPlaylistUpstreamUnavailable,
} from '../scripts/amazon-music-track-playlist-refresh-entry.js';

const upstreamError = 'Amazon Music /api/cosmicTrack/showTrackDetailSeeMore failed with HTTP 500';

function errors(count, error = upstreamError) {
  return Array.from({ length: count }, (_, index) => ({
    amazon_music_id: `track-${index}`,
    error,
  }));
}

test('classifies only complete all-batch related-playlists 5xx failures as upstream unavailable', () => {
  assert.equal(isAmazonPlaylistUpstreamUnavailable({
    batch_tracks: 25,
    succeeded: 0,
    failed: 25,
  }, errors(25)), true);

  assert.equal(isAmazonPlaylistUpstreamUnavailable({
    batch_tracks: 25,
    succeeded: 1,
    failed: 24,
  }, errors(24)), false);

  assert.equal(isAmazonPlaylistUpstreamUnavailable({
    batch_tracks: 25,
    succeeded: 0,
    failed: 25,
  }, errors(24)), false);

  assert.equal(isAmazonPlaylistUpstreamUnavailable({
    batch_tracks: 25,
    succeeded: 0,
    failed: 25,
  }, [...errors(24), { error: 'Amazon Music config failed with HTTP 500' }]), false);
});

test('scopes error samples to the current collection attempt', () => {
  const observedAt = 123456;
  const samples = amazonPlaylistErrorSamplesForAttempt([
    {
      status: 'error',
      error: upstreamError,
      last_attempt_at: observedAt,
      amazon_music_id: 'current-error',
      title: 'Current',
    },
    {
      status: 'error',
      error: 'stale error',
      last_attempt_at: observedAt - 1,
      amazon_music_id: 'stale-error',
    },
    {
      status: 'ok',
      error: upstreamError,
      last_attempt_at: observedAt,
      amazon_music_id: 'current-ok',
    },
  ], observedAt);

  assert.deepEqual(samples, [{
    group_name: undefined,
    title: 'Current',
    amazon_music_id: 'current-error',
    error: upstreamError,
  }]);
});
