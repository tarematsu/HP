import assert from 'node:assert/strict';
import test from 'node:test';

import {
  amazonMusicTrackPlaylistFetch,
  normalizeAmazonTrackPlaylistActionRequest,
} from '../src/amazon-music-track-playlist-fetch.js';

test('moves showTrackDetailSeeMore query parameters into the POST body', () => {
  const normalized = normalizeAmazonTrackPlaylistActionRequest(
    'https://fe.mesk.skill.music.a2z.com/api/cosmicTrack/showTrackDetailSeeMore?id=B0TEST&pageType=related-playlists&userHash=%7B%22level%22%3A%22LIBRARY_MEMBER%22%7D',
    {
      method: 'POST',
      body: JSON.stringify({ headers: 'amazon-headers' }),
    },
  );

  assert.equal(normalized.url, 'https://fe.mesk.skill.music.a2z.com/api/cosmicTrack/showTrackDetailSeeMore');
  assert.deepEqual(JSON.parse(normalized.init.body), {
    id: 'B0TEST',
    pageType: 'related-playlists',
    userHash: '{"level":"LIBRARY_MEMBER"}',
    headers: 'amazon-headers',
  });
});

test('leaves unrelated Amazon requests unchanged', async () => {
  let seenInput;
  let seenInit;
  const response = { ok: true };
  const fakeFetch = async (input, init) => {
    seenInput = input;
    seenInit = init;
    return response;
  };

  const init = { method: 'POST', body: '{}' };
  const result = await amazonMusicTrackPlaylistFetch(
    'https://fe.mesk.skill.music.a2z.com/api/cosmicTrack/displayCatalogTrack',
    init,
    fakeFetch,
  );

  assert.equal(result, response);
  assert.equal(seenInput, 'https://fe.mesk.skill.music.a2z.com/api/cosmicTrack/displayCatalogTrack');
  assert.equal(seenInit, init);
});
