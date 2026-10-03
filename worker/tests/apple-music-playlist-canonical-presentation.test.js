import assert from 'node:assert/strict';
import test from 'node:test';

import { canonicalizeAppleMusicPlaylistPresentation } from '../src/apple-music-playlist-canonical-presentation.js';
import { APPLE_MUSIC_PLAYLIST_PAGES_MODEL_KEY } from '../src/apple-music-playlist-collector.js';
import { pagesActionsR2ResponseKey } from '../src/pages-response-r2.js';

const LATEST_KEY = 'apple-music/playlists/latest.json';

class FakeR2 {
  constructor(initial = {}) {
    this.values = new Map(Object.entries(initial).map(([key, value]) => [key, JSON.stringify(value)]));
    this.putCount = 0;
  }

  async get(key) {
    const value = this.values.get(key);
    if (value == null) return null;
    return {
      async json() { return JSON.parse(value); },
      async text() { return value; },
    };
  }

  async put(key, value) {
    this.putCount += 1;
    this.values.set(key, String(value));
  }
}

class FakeOtherDb {
  constructor(refs = {}) {
    this.refs = refs;
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
        if (!sql.includes('FROM music_service_track_refs')) throw new Error(`unexpected SQL: ${sql}`);
        return {
          results: this.args
            .filter((appleId) => database.refs[appleId] != null)
            .map((appleId) => ({ source_track_id: appleId, track_id: database.refs[appleId] })),
        };
      },
    };
  }
}

class FakeMinuteDb {
  constructor(rows) {
    this.rows = rows;
    this.reads = 0;
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
        database.reads += 1;
        if (sql.includes('FROM sh_tracks WHERE stationhead_track_id IN')) return { results: [] };
        if (
          sql.includes('FROM sh_tracks WHERE title IS NOT NULL')
          || sql.includes('FROM sh_track_dictionary WHERE title IS NOT NULL')
        ) {
          const titles = new Set(this.args.map((value) => String(value).trim().toLocaleLowerCase('ja-JP')));
          return {
            results: database.rows.filter((row) => titles.has(String(row.title).trim().toLocaleLowerCase('ja-JP'))),
          };
        }
        if (sql.includes('FROM sh_track_canonical_metadata WHERE title IS NOT NULL')) {
          const titles = new Set(this.args.map((value) => String(value).trim().toLocaleLowerCase('ja-JP')));
          return {
            results: database.rows.filter((row) => titles.has(String(row.title).trim().toLocaleLowerCase('ja-JP'))),
          };
        }
        if (sql.includes('FROM sh_track_canonical_metadata WHERE track_id IN')) {
          const ids = new Set(this.args.map(Number));
          return { results: database.rows.filter((row) => ids.has(Number(row.track_id))) };
        }
        if (sql.includes('FROM sh_track_canonical_metadata WHERE track_id IS NOT NULL AND isrc IN')) {
          const values = new Set(this.args.map(String));
          return { results: database.rows.filter((row) => values.has(String(row.isrc))) };
        }
        if (sql.includes('FROM sh_track_canonical_metadata WHERE track_id IS NOT NULL AND spotify_id IN')) {
          const values = new Set(this.args.map(String));
          return { results: database.rows.filter((row) => values.has(String(row.spotify_id))) };
        }
        throw new Error(`unexpected SQL: ${sql}`);
      },
    };
  }

  async batch() {}
}

test('Apple Music playlist presentation canonicalizes provider titles and resolves playlist-only tracks', async () => {
  const observedAt = Date.UTC(2026, 9, 1, 18, 15, 0);
  const model = {
    version: 1,
    source: 'music.apple.com-public-pages',
    artist_id: '1541126420',
    artist_name: '櫻坂46',
    observed_at: observedAt - 1000,
    scan_date: '2026-10-02',
    coverage: { matched_playlists: 1 },
    playlists: [{
      id: 'pl.test',
      name: 'Test',
      curator: 'Apple Music',
      url: 'https://music.apple.com/jp/playlist/test/pl.test',
      tracks: [
        {
          apple_music_id: 'apple-101',
          track_id: null,
          title: 'Samidareyo',
          position: 1,
          url: 'https://music.apple.com/jp/song/a/101',
        },
        {
          apple_music_id: 'apple-202',
          track_id: null,
          title: 'マモリビト',
          position: 2,
          url: 'https://music.apple.com/jp/song/b/202',
        },
      ],
    }],
    tracks: [],
  };
  const r2 = new FakeR2({ [LATEST_KEY]: model });
  const otherDb = new FakeOtherDb({ 'apple-101': 101 });
  const minuteDb = new FakeMinuteDb([
    {
      track_id: 101,
      stationhead_track_id: null,
      isrc: 'JPAAA2600101',
      spotify_id: 'spotify-101',
      title: '五月雨よ',
      artist: '櫻坂46',
      thumbnail_url: null,
      fetched_at: observedAt - 5000,
    },
    {
      track_id: 202,
      stationhead_track_id: null,
      isrc: 'JPAAA2600202',
      spotify_id: 'spotify-202',
      title: 'マモリビト',
      artist: '櫻坂46',
      thumbnail_url: null,
      fetched_at: observedAt - 4000,
    },
  ]);

  const result = await canonicalizeAppleMusicPlaylistPresentation({
    PAGES_RESPONSE_R2: r2,
    OTHER_DB: otherDb,
    MINUTE_DB: minuteDb,
  }, observedAt);

  assert.equal(result.updated, true);
  assert.equal(result.presentation_changed, true);
  assert.equal(result.source_refs, 1);
  const stored = JSON.parse(r2.values.get(LATEST_KEY));
  assert.deepEqual(stored.playlists[0].tracks.map((track) => [track.track_id, track.title]), [
    [101, '五月雨よ'],
    [202, 'マモリビト'],
  ]);
  assert.deepEqual(stored.tracks.map((track) => track.key).sort(), ['track:101', 'track:202']);
  assert.equal(stored.canonical_presentation_version, 2);

  const publicKey = pagesActionsR2ResponseKey(APPLE_MUSIC_PLAYLIST_PAGES_MODEL_KEY);
  const envelope = JSON.parse(r2.values.get(publicKey));
  const publicModel = JSON.parse(envelope.body);
  assert.equal(publicModel.playlists[0].tracks[0].title, '五月雨よ');
  assert.equal(envelope.renderer_revision, 'apple-music-playlists-v3');

  const writesAfterFirst = r2.putCount;
  const second = await canonicalizeAppleMusicPlaylistPresentation({
    PAGES_RESPONSE_R2: r2,
    OTHER_DB: otherDb,
    MINUTE_DB: minuteDb,
  }, observedAt + 60 * 60_000);
  assert.equal(second.updated, false);
  assert.equal(second.reason, 'fresh');
  assert.equal(r2.putCount, writesAfterFirst);
});
