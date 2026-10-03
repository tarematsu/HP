import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  SPOTIFY_PLAYLIST_MODEL_KEY,
  SPOTIFY_PLAYLIST_PAGES_MODEL_KEY,
  SPOTIFY_PLAYLIST_STATE_KEY,
  collectSpotifyPlaylists,
  extractSpotifyPlaylistLinks,
  parseSpotifyPlaylistEmbed,
} from '../src/spotify-playlist-collector.js';
import { pagesActionsR2ResponseKey } from '../src/pages-response-r2.js';

const PLAYLIST_ID = '1234567890ABCDEFGHIJKL';
const TRACK_ID = '0123456789ABCDEFGHIJKL';
const OTHER_TRACK_ID = 'ZYXWVUTSRQPONMLKJIHGFE';
const PLAYLIST_URL = `https://open.spotify.com/playlist/${PLAYLIST_ID}`;

function embedHtml() {
  const data = {
    props: {
      pageProps: {
        state: {
          data: {
            entity: {
              title: 'Spotify Test Playlist',
              subtitle: 'Spotify Japan',
              coverArt: { sources: [{ url: 'https://example.test/cover.jpg' }] },
              trackList: [
                {
                  title: 'Samidareyo',
                  subtitle: 'Sakurazaka46',
                  uri: `spotify:track:${TRACK_ID}`,
                  artistUri: 'spotify:artist:0Ti7MfCiVVQAK8zLSiqlto',
                },
                {
                  title: 'Other Song',
                  subtitle: 'Other Artist',
                  uri: `spotify:track:${OTHER_TRACK_ID}`,
                },
              ],
            },
          },
        },
      },
    },
  };
  return `<!doctype html><html><head><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script></head></html>`;
}

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

class FakeD1 {
  constructor(rows) {
    this.rows = rows;
  }

  prepare(sql) {
    const database = this;
    return {
      args: [],
      bind(...args) {
        this.args = args;
        return this;
      },
      async all() {
        if (sql.includes('FROM sh_tracks WHERE stationhead_track_id IN')) return { results: [] };
        if (sql.includes('FROM sh_tracks WHERE spotify_id IN')) {
          const ids = new Set(this.args.map(String));
          return { results: database.rows
            .filter((row) => ids.has(String(row.spotify_id)))
            .map((row) => ({ track_id:row.track_id, alias_value:row.spotify_id })) };
        }
        if (sql.includes('FROM sh_track_canonical_metadata') && sql.includes('track_id IN')) {
          const ids = new Set(this.args.map(Number));
          return { results: database.rows.filter((row) => ids.has(Number(row.track_id))) };
        }
        if (sql.includes('FROM sh_track_canonical_metadata') && sql.includes('isrc IN')) return { results: [] };
        if (sql.includes("FROM sh_track_aliases") && sql.includes("alias_type='spotify_id'")) return { results: [] };
        if (sql.includes('FROM sh_track_dictionary WHERE spotify_id IN')) return { results: [] };
        throw new Error(`unexpected SQL: ${sql}`);
      },
    };
  }

  async batch() {}
}

test('Spotify playlist link discovery keeps only canonical public playlist URLs', () => {
  const links = extractSpotifyPlaylistLinks(`
    <a href="/playlist/${PLAYLIST_ID}?si=abc">one</a>
    <a href="https://open.spotify.com/embed/playlist/ABCDEFGHIJKLMNOPQRSTUV?theme=0">two</a>
    <a href="https://example.com/playlist/1234567890ABCDEFGHIJKL">bad</a>
  `);
  assert.deepEqual(links, [
    PLAYLIST_URL,
    'https://open.spotify.com/playlist/ABCDEFGHIJKLMNOPQRSTUV',
  ]);
});

test('Spotify embed parser keeps only Sakurazaka tracks and captures provider ids', () => {
  const parsed = parseSpotifyPlaylistEmbed(embedHtml(), `${PLAYLIST_URL}?si=test`);
  assert.equal(parsed.id, PLAYLIST_ID);
  assert.equal(parsed.name, 'Spotify Test Playlist');
  assert.equal(parsed.curator, 'Spotify Japan');
  assert.equal(parsed.artwork, 'https://example.test/cover.jpg');
  assert.deepEqual(parsed.tracks, [{
    spotify_id: TRACK_ID,
    title: 'Samidareyo',
    artist: 'Sakurazaka46',
    position: 1,
    url: `https://open.spotify.com/track/${TRACK_ID}`,
  }]);
});

test('Spotify playlist collection publishes canonical tracks from public embed pages', async () => {
  const r2 = new FakeR2({
    [SPOTIFY_PLAYLIST_STATE_KEY]: {
      version: 1,
      playlists: [{
        id: PLAYLIST_ID,
        url: PLAYLIST_URL,
        priority: 1,
        discovered_at: 1,
        last_scanned_at: null,
        tracks: [],
      }],
    },
  });
  const db = new FakeD1([{
    track_id: 42,
    stationhead_track_id: null,
    isrc: 'JPAAA2600042',
    spotify_id: TRACK_ID,
    title: '五月雨よ',
    artist: '櫻坂46',
    thumbnail_url: null,
  }]);
  const requests = [];
  const fetchImpl = async (url) => {
    requests.push(String(url));
    return new Response(embedHtml(), { status: 200 });
  };

  const result = await collectSpotifyPlaylists(
    { PAGES_RESPONSE_R2: r2, MINUTE_DB: db },
    Date.UTC(2026, 9, 1, 5, 0, 0),
    fetchImpl,
    { discover: false },
  );

  assert.equal(result.ok, true);
  assert.equal(result.known_playlists, 1);
  assert.equal(result.scanned_playlists, 1);
  assert.equal(result.matched_playlists, 1);
  assert.deepEqual(requests, [`https://open.spotify.com/embed/playlist/${PLAYLIST_ID}`]);

  const latest = JSON.parse(r2.values.get(SPOTIFY_PLAYLIST_MODEL_KEY));
  assert.equal(latest.source, 'open.spotify.com-public-pages');
  assert.equal(latest.playlists[0].tracks[0].track_id, 42);
  assert.equal(latest.playlists[0].tracks[0].title, '五月雨よ');

  const publicKey = pagesActionsR2ResponseKey(SPOTIFY_PLAYLIST_PAGES_MODEL_KEY);
  const envelope = JSON.parse(r2.values.get(publicKey));
  const payload = JSON.parse(envelope.body);
  assert.equal(payload.artist_id, '0Ti7MfCiVVQAK8zLSiqlto');
  assert.equal(payload.tracks[0].track_id, 42);
});

test('Spotify playlist collector stays on public open.spotify.com pages', () => {
  const source = readFileSync(new URL('../src/spotify-playlist-collector.js', import.meta.url), 'utf8');
  assert.match(source, /open\.spotify\.com-public-pages/);
  assert.match(source, /__NEXT_DATA__/);
  assert.doesNotMatch(source, /api\.spotify\.com|spclient\.wg\.spotify\.com|client_secret|Authorization:\s*Bearer/i);
});
