import assert from 'node:assert/strict';
import test from 'node:test';

import {
  boomplaySearchUrl,
  extractBoomplaySongIds,
  parseBoomplayTrackSchema,
} from '../src/regional-music-boomplay.js';

test('Boomplay search URL and song IDs use public web paths', () => {
  assert.equal(boomplaySearchUrl('Nogizaka46'), 'https://www.boomplay.com/search/default/Nogizaka46');
  assert.deepEqual(
    extractBoomplaySongIds('<div data-id="123"></div><a href="/songs/456">x</a><div data-id="123"></div>'),
    ['123', '456'],
  );
});

test('Boomplay parses MusicRecording JSON-LD', () => {
  const html = `<script type="application/ld+json">${JSON.stringify({
    '@type': 'MusicRecording',
    name: 'Test Song',
    byArtist: [{ name: 'Sakurazaka46' }],
    inAlbum: { name: 'Test Album' },
  })}</script>`;
  assert.deepEqual(parseBoomplayTrackSchema(html), {
    title: 'Test Song',
    artists: ['Sakurazaka46'],
    album_name: 'Test Album',
  });
});

test('Boomplay ignores malformed or unrelated JSON-LD', () => {
  assert.equal(parseBoomplayTrackSchema('<script type="application/ld+json">{bad}</script>'), null);
  assert.equal(parseBoomplayTrackSchema('<script type="application/ld+json">{"@type":"MusicAlbum"}</script>'), null);
});
