import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AMAZON_MUSIC_TRACK_PLAYLIST_MODEL_KEY,
  AMAZON_MUSIC_TRACK_PLAYLIST_STATE_KEY,
  collectAmazonMusicTrackPlaylists,
  extractAmazonTrackRelatedPlaylists,
  selectAmazonTrackPlaylistBatch,
} from '../src/amazon-music-track-playlist-collector.js';

class FakeR2 {
  constructor(seed = {}) {
    this.values = new Map(Object.entries(seed).map(([key, value]) => [key, JSON.stringify(value)]));
  }

  async get(key) {
    if (!this.values.has(key)) return null;
    const raw = this.values.get(key);
    return {
      json: async () => JSON.parse(raw),
      text: async () => raw,
    };
  }

  async put(key, value) {
    this.values.set(key, String(value));
  }

  json(key) {
    return JSON.parse(this.values.get(key));
  }
}

function sourceModel() {
  return {
    observed_at: 1_000,
    tracks: [
      { amazon_music_id: 'A1', track_id: 101, group_name: '櫻坂46', title: '曲A', album: 'Album A', amazon_rank: 20 },
      { amazon_music_id: 'A2', track_id: 102, group_name: '乃木坂46', title: '曲B', album: 'Album B', amazon_rank: 10 },
      { amazon_music_id: 'A3', track_id: 103, group_name: '日向坂46', title: '曲C', album: 'Album C', amazon_rank: 30 },
    ],
  };
}

test('extracts Amazon related playlists with public and catalog identifiers', () => {
  const payload = {
    methods: [{
      template: {
        widgets: [{
          items: [{
            primaryText: { text: 'ベスト・オブ・J-POP' },
            secondaryText: { text: 'Amazon Music' },
            image: { url: 'https://example.test/cover.jpg' },
            primaryTextLink: {
              deeplink: '/playlists/BEST123',
              onItemSelected: [{
                url: 'https://fe.mesk.skill.music.a2z.com/api/showCatalogPlaylist?id=uri%3A%2F%2Fplaylist%2Finternal-123&userHash=x',
              }],
            },
          }],
        }],
      },
    }],
  };

  assert.deepEqual(extractAmazonTrackRelatedPlaylists(payload), [{
    playlist_id: 'BEST123',
    catalog_id: 'uri://playlist/internal-123',
    name: 'ベスト・オブ・J-POP',
    curator: 'Amazon Music',
    image: 'https://example.test/cover.jpg',
    url: 'https://music.amazon.co.jp/playlists/BEST123',
  }]);
});

test('batch prioritizes never-attempted tracks and then oldest attempts', () => {
  const tracks = sourceModel().tracks;
  const state = {
    tracks: {
      A1: { last_attempt_at: 500 },
      A2: { last_attempt_at: 100 },
    },
  };

  assert.deepEqual(
    selectAmazonTrackPlaylistBatch(tracks, state, 3).map((track) => track.amazon_music_id),
    ['A3', 'A2', 'A1'],
  );
});

test('collector stores per-track playlists and preserves first-seen history', async () => {
  const r2 = new FakeR2({ 'amazon-music/read-model/latest.json': sourceModel() });
  const env = { PAGES_RESPONSE_R2: r2 };
  const firstLookup = async (id) => id === 'A2'
    ? [{ playlist_id: 'P2', catalog_id: 'C2', name: 'Playlist 2', curator: 'Amazon Music', image: null, url: 'https://music.amazon.co.jp/playlists/P2' }]
    : [{ playlist_id: 'P1', catalog_id: 'C1', name: 'Playlist 1', curator: 'Amazon Music', image: null, url: 'https://music.amazon.co.jp/playlists/P1' }];

  const first = await collectAmazonMusicTrackPlaylists(env, 2_000, fetch, firstLookup);
  assert.deepEqual(first, {
    handled: true,
    batch_tracks: 3,
    succeeded: 3,
    failed: 0,
    total_tracks: 3,
    checked_tracks: 3,
    pending_tracks: 0,
  });

  const stateAfterFirst = r2.json(AMAZON_MUSIC_TRACK_PLAYLIST_STATE_KEY);
  assert.equal(stateAfterFirst.tracks.A1.playlists[0].first_seen_at, 2_000);
  assert.equal(stateAfterFirst.tracks.A1.playlists[0].last_seen_at, 2_000);
  assert.equal(stateAfterFirst.tracks.A2.playlists[0].playlist_id, 'P2');

  const secondLookup = async (id) => {
    if (id === 'A3') throw new Error('temporary Amazon error');
    return id === 'A1'
      ? [{ playlist_id: 'P1', catalog_id: 'C1', name: 'Playlist 1 renamed', curator: 'Amazon Music', image: null, url: 'https://music.amazon.co.jp/playlists/P1' }]
      : [];
  };
  const second = await collectAmazonMusicTrackPlaylists(env, 3_000, fetch, secondLookup);
  assert.equal(second.succeeded, 2);
  assert.equal(second.failed, 1);

  const stateAfterSecond = r2.json(AMAZON_MUSIC_TRACK_PLAYLIST_STATE_KEY);
  assert.equal(stateAfterSecond.tracks.A1.playlists[0].first_seen_at, 2_000);
  assert.equal(stateAfterSecond.tracks.A1.playlists[0].last_seen_at, 3_000);
  assert.equal(stateAfterSecond.tracks.A1.playlists[0].name, 'Playlist 1 renamed');
  assert.equal(stateAfterSecond.tracks.A2.playlists.length, 0);
  assert.equal(stateAfterSecond.tracks.A3.status, 'error');
  assert.equal(stateAfterSecond.tracks.A3.playlists[0].playlist_id, 'P1');

  const latest = r2.json(AMAZON_MUSIC_TRACK_PLAYLIST_MODEL_KEY);
  assert.equal(latest.coverage.total_tracks, 3);
  assert.equal(latest.coverage.checked_tracks, 3);
  assert.equal(latest.coverage.error_tracks, 1);
  assert.equal(latest.tracks.find((track) => track.amazon_music_id === 'A3').playlist_count, 1);
});
