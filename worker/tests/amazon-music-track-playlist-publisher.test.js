import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AMAZON_MUSIC_TRACK_PLAYLIST_PAGES_MODEL_KEY,
  publishAmazonMusicTrackPlaylistModel,
} from '../src/amazon-music-track-playlist-publisher.js';
import { AMAZON_MUSIC_TRACK_PLAYLIST_MODEL_KEY } from '../src/amazon-music-track-playlist-collector.js';
import { pagesR2ResponseKey } from '../src/pages-response-r2.js';

function r2Store(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    values,
    async get(key) {
      if (!values.has(key)) return null;
      const body = values.get(key);
      return {
        async json() { return JSON.parse(body); },
        async text() { return body; },
      };
    },
    async put(key, body) { values.set(key, String(body)); },
  };
}

test('Amazon Music track playlists publish as a Pages read model', async () => {
  const model = {
    version: 1,
    source: 'amazon-music-track-related-playlists',
    observed_at: 1_234,
    tracks: [{ title: '自業自得', playlist_count: 1, playlists: [{ playlist_id: 'P1', name: 'Test' }] }],
  };
  const r2 = r2Store({ [AMAZON_MUSIC_TRACK_PLAYLIST_MODEL_KEY]: JSON.stringify(model) });
  const result = await publishAmazonMusicTrackPlaylistModel({ PAGES_RESPONSE_R2: r2 }, 2_000);
  assert.equal(result.published, true);
  assert.equal(result.tracks, 1);

  const key = pagesR2ResponseKey(AMAZON_MUSIC_TRACK_PLAYLIST_PAGES_MODEL_KEY);
  const envelope = JSON.parse(r2.values.get(key));
  assert.equal(envelope.status, 200);
  assert.equal(envelope.updated_at, 2_000);
  assert.equal(envelope.cadence_seconds, 43_200);
  const payload = JSON.parse(envelope.body);
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.tracks, model.tracks);
});

test('publisher skips cleanly before the first playlist model exists', async () => {
  const r2 = r2Store();
  assert.deepEqual(
    await publishAmazonMusicTrackPlaylistModel({ PAGES_RESPONSE_R2: r2 }, 2_000),
    { published: false, reason: 'model-empty' },
  );
});
