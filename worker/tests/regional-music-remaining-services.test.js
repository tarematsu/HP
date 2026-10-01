import assert from 'node:assert/strict';
import test from 'node:test';

import {
  plernCatalogUnavailable,
  plernSearchUrl,
} from '../src/regional-music-plern.js';
import {
  fungjaiArtistSlug,
  fungjaiArtistUrl,
  parseFungjaiTrackLinks,
} from '../src/regional-music-fungjai.js';
import {
  langitSearchUrl,
  parseLangitSearch,
} from '../src/regional-music-langit.js';

test('Plern detects the current coming-soon public catalog state', () => {
  assert.equal(plernSearchUrl('櫻坂46'), 'https://plern.co/search?q=%E6%AB%BB%E5%9D%8246');
  assert.equal(plernCatalogUnavailable('<h1>เปิดตัวเร็วๆ นี้</h1>'), true);
  assert.equal(plernCatalogUnavailable('<h1>Coming Soon</h1>'), true);
  assert.equal(plernCatalogUnavailable('<h1>Music catalog</h1>'), false);
});

test('Fungjai legacy artist and music paths are parsed conservatively', () => {
  assert.equal(fungjaiArtistSlug('Sakurazaka46'), 'sakurazaka46');
  assert.equal(fungjaiArtistUrl('sakurazaka46'), 'https://www.fungjai.com/artists/sakurazaka46');
  const html = '<a href="/artists/sakurazaka46/musics/test-song">Test Song</a>'
    + '<a href="/artists/other/musics/wrong">Wrong</a>';
  assert.deepEqual(parseFungjaiTrackLinks(html, 'sakurazaka46', ['櫻坂46', 'Sakurazaka46']), [{
    track_id: 'sakurazaka46/test-song',
    title: 'Test Song',
    track_url: 'https://www.fungjai.com/artists/sakurazaka46/musics/test-song',
  }]);
});

test('Langit collector parses authorized public structured data and old share links', () => {
  assert.equal(
    langitSearchUrl('Nogizaka46', 'https://example.test/search?keyword={query}'),
    'https://example.test/search?keyword=Nogizaka46',
  );
  const schema = `<script type="application/ld+json">${JSON.stringify({
    '@type': 'MusicRecording',
    identifier: 'LM123',
    name: 'Target',
    byArtist: [{ name: 'Nogizaka46' }],
    inAlbum: { name: 'Album' },
    url: 'https://langitmusik.co.id/shareSong.do?songId=123',
  })}</script>`;
  assert.deepEqual(parseLangitSearch(schema, ['乃木坂46', 'Nogizaka46']), [{
    track_id: 'LM123',
    title: 'Target',
    album_name: 'Album',
    track_url: 'https://langitmusik.co.id/shareSong.do?songId=123',
  }]);
});
