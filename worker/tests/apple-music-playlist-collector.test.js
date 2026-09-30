import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  APPLE_MUSIC_PLAYLIST_PAGES_MODEL_KEY,
  APPLE_MUSIC_PLAYLIST_SEEDS,
  collectAppleMusicPlaylists,
  extractAppleMusicPlaylistLinks,
  parseAppleMusicPlaylistPage,
} from '../src/apple-music-playlist-collector.js';
import { pagesActionsR2ResponseKey } from '../src/pages-response-r2.js';

const PLAYLIST_URL = 'https://music.apple.com/jp/playlist/test-list/pl.abc123';
const PLAYLIST_HTML = `<!doctype html>
<html>
<head>
<meta property="og:title" content="テストプレイリスト -プレイリスト - Apple Music">
<meta property="og:image" content="https://example.invalid/artwork.jpg">
<script type="application/ld+json">
${JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'MusicPlaylist',
  name: 'テストプレイリスト',
  creator: { '@type': 'Organization', name: 'Apple Music J-Pop' },
  track: [
    {
      '@type': 'ListItem',
      position: 4,
      item: {
        '@type': 'MusicRecording',
        name: 'UDAGAWA GENERATION',
        byArtist: { '@type': 'MusicGroup', name: '櫻坂46', url: 'https://music.apple.com/jp/artist/-/1541126420' },
        url: 'https://music.apple.com/jp/album/example/1800000000?i=1800000001',
      },
    },
    {
      '@type': 'ListItem',
      position: 5,
      item: {
        '@type': 'MusicRecording',
        name: '別アーティスト曲',
        byArtist: { '@type': 'MusicGroup', name: 'Other Artist' },
        url: 'https://music.apple.com/jp/song/example/1800000002',
      },
    },
  ],
})}
</script>
</head>
<body>
<a href="/jp/playlist/related/pl.related999?l=ja">related</a>
</body>
</html>`;

class FakeR2 {
  constructor(initial = {}) {
    this.values = new Map(Object.entries(initial).map(([key, value]) => [key, JSON.stringify(value)]));
  }

  async get(key) {
    const value = this.values.get(key);
    if (value == null) return null;
    return {
      json: async () => JSON.parse(value),
      text: async () => value,
    };
  }

  async put(key, value) {
    this.values.set(key, String(value));
  }
}

test('playlist link discovery keeps only public music.apple.com playlist URLs', () => {
  const links = extractAppleMusicPlaylistLinks(`
    <a href="/jp/playlist/foo/pl.one123?l=ja">one</a>
    <a href="https://music.apple.com/jp/playlist/bar/pl.two456#tracks">two</a>
    <a href="https://example.com/jp/playlist/no/pl.bad999">bad</a>
  `);
  assert.deepEqual(links, [
    'https://music.apple.com/jp/playlist/foo/pl.one123',
    'https://music.apple.com/jp/playlist/bar/pl.two456',
  ]);
});

test('playlist parser keeps only Sakurazaka recordings and captures position/catalog id', () => {
  const parsed = parseAppleMusicPlaylistPage(PLAYLIST_HTML, `${PLAYLIST_URL}?l=ja`);
  assert.equal(parsed.id, 'pl.abc123');
  assert.equal(parsed.name, 'テストプレイリスト');
  assert.equal(parsed.curator, 'Apple Music J-Pop');
  assert.equal(parsed.url, PLAYLIST_URL);
  assert.deepEqual(parsed.tracks, [{
    apple_music_id: '1800000001',
    title: 'UDAGAWA GENERATION',
    url: 'https://music.apple.com/jp/album/example/1800000000?i=1800000001',
    position: 4,
  }]);
  assert.deepEqual(parsed.related_urls, ['https://music.apple.com/jp/playlist/related/pl.related999']);
});

test('daily playlist collection crawls only public Apple Music pages and publishes a track reverse index', async () => {
  const r2 = new FakeR2({
    'apple-music/read-model/latest.json': {
      regions: [{
        code: 'jp',
        tracks: [{
          apple_music_id: '1800000001',
          track_id: 42,
          title: 'UDAGAWA GENERATION',
        }],
      }],
    },
  });
  const requests = [];
  const fetchImpl = async (url) => {
    requests.push(String(url));
    if (String(url).includes('/playlist/')) return new Response(PLAYLIST_HTML, { status: 200 });
    return new Response(`<a href="${PLAYLIST_URL}">playlist</a>`, { status: 200 });
  };
  const now = Date.UTC(2026, 9, 1, 18, 15, 0);

  const result = await collectAppleMusicPlaylists({ PAGES_RESPONSE_R2: r2 }, now, fetchImpl);
  assert.equal(result.ok, true);
  assert.equal(result.skipped, false);
  assert.equal(result.matched_playlists, 1);
  assert.equal(result.matched_tracks, 1);
  assert.ok(requests.length >= APPLE_MUSIC_PLAYLIST_SEEDS.length + 1);
  assert.ok(requests.every((url) => url.startsWith('https://music.apple.com/')));
  assert.ok(requests.every((url) => !url.includes('api.music.apple.com')));

  const publicKey = pagesActionsR2ResponseKey(APPLE_MUSIC_PLAYLIST_PAGES_MODEL_KEY);
  const envelope = JSON.parse(r2.values.get(publicKey));
  const payload = JSON.parse(envelope.body);
  assert.equal(payload.source, 'music.apple.com-public-pages');
  assert.equal(payload.coverage.matched_playlists, 1);
  assert.equal(payload.tracks[0].track_id, 42);
  assert.equal(payload.tracks[0].title, 'UDAGAWA GENERATION');
  assert.equal(payload.tracks[0].playlists[0].id, 'pl.abc123');

  const callsBeforeSecondRun = requests.length;
  const second = await collectAppleMusicPlaylists({ PAGES_RESPONSE_R2: r2 }, now + 60_000, fetchImpl);
  assert.equal(second.skipped, true);
  assert.equal(requests.length, callsBeforeSecondRun);
});

test('playlist collector source does not call the Apple Music catalog API', () => {
  const source = readFileSync(new URL('../src/apple-music-playlist-collector.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /api\.music\.apple\.com/);
  assert.match(source, /music\.apple\.com-public-pages/);
});