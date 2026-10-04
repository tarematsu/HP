import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hydratePlaybackAggregates,
  hydratePlaybackTrackMetadata,
  resolveMissingSpotifyPresentation,
} from '../src/playback-track-metadata.js';

const canonical = {
  track_id: 898,
  title: '自称バレエダンサー',
  artist: '櫻坂46',
  thumbnail_url: 'https://example.test/art.jpg',
  spotify_id: 'spotify898',
  presentation_version: 1,
};

function catalog() {
  const queries = [];
  return {
    queries,
    batch() {},
    prepare(sql) {
      return { bind(...ids) {
        queries.push({ sql, ids });
        return { async all() { return { results: ids.includes(898) ? [canonical] : [] }; } };
      } };
    },
  };
}

test('an existing canonical ID still hydrates missing display metadata without losing queue fields', async () => {
  const db = catalog();
  const [track] = await hydratePlaybackTrackMetadata(db, [{ track_id: 898, title: '曲名不明', position: 2, played_count: 7 }]);
  assert.equal(track.title, canonical.title);
  assert.equal(track.artist, canonical.artist);
  assert.equal(track.thumbnail_url, canonical.thumbnail_url);
  assert.equal(track.position, 2);
  assert.equal(track.played_count, 7);
  assert.equal(track.presentation_version, 1);
  assert.equal(db.queries.length, 1);
  assert.deepEqual(db.queries[0].ids, [898]);
});

test('complete provisional Stationhead romanization is verified once and replaced by canonical Spotify presentation', async () => {
  const db = catalog();
  const [track] = await hydratePlaybackTrackMetadata(db, [{
    track_id: 898,
    spotify_id: 'spotify898',
    title: 'Jisho Ballet Dancer',
    artist: 'Sakurazaka46',
    thumbnail_url: 'https://example.test/stationhead.jpg',
  }]);
  assert.equal(track.title, '自称バレエダンサー');
  assert.equal(track.artist, '櫻坂46');
  assert.equal(track.thumbnail_url, canonical.thumbnail_url);
  assert.equal(track.presentation_version, 1);
  assert.equal(db.queries.length, 1);
});

test('complete cached canonical metadata satisfies an unchanged queue without database reads', async () => {
  const db = catalog();
  const [track] = await hydratePlaybackTrackMetadata(db, [{ track_id: 898, position: 1 }], [canonical]);
  assert.equal(track.title, canonical.title);
  assert.equal(track.position, 1);
  assert.equal(track.presentation_version, 1);
  assert.equal(db.queries.length, 0);
});

test('an unrelated cached track cannot supply metadata to another identity', async () => {
  const db = catalog();
  const [track] = await hydratePlaybackTrackMetadata(db, [{ track_id: 899 }], [canonical]);
  assert.equal(track.track_id, 899);
  assert.equal(track.title, null);
  assert.deepEqual(db.queries[0].ids, [899]);
});

test('aggregate repair preserves totals, likes and timestamps and is reused without artwork', async () => {
  const db = catalog();
  const daily = { total_plays: 9, tracks: { 898: { track_id: 898, count: 9 } } };
  const likes = { 898: { track_id: 898, likes: 42, observed_at: 1234 } };
  const repaired = await hydratePlaybackAggregates(db, daily, likes);
  assert.equal(repaired.daily.total_plays, 9);
  assert.equal(repaired.daily.tracks[898].count, 9);
  assert.equal(repaired.daily.tracks[898].title, canonical.title);
  assert.equal(repaired.likes[898].likes, 42);
  assert.equal(repaired.likes[898].observed_at, 1234);
  delete repaired.daily.tracks[898].thumbnail_url;
  delete repaired.likes[898].thumbnail_url;
  await hydratePlaybackAggregates(db, repaired.daily, repaired.likes);
  assert.equal(db.queries.length, 1);
});

test('complete Stationhead title and artist skip direct Spotify repair lookup', async () => {
  const db = {
    prepare() { throw new Error('D1 should not be read'); },
  };
  const source = [{ spotify_id: 'complete1', title: 'Song', artist: 'Artist' }];
  const result = await resolveMissingSpotifyPresentation(db, source);
  assert.equal(result[0].title, 'Song');
  assert.equal(result[0].artist, 'Artist');
});

test('stored authoritative Spotify metadata replaces a provisional romanized title during repair', async () => {
  const db = {
    prepare(sql) {
      assert.match(sql.trim(), /^SELECT spotify_id/is);
      return {
        bind() {
          return {
            async all() {
              return { results: [{
                spotify_id: 'spotify-new-release',
                title: '自称バレエダンサー',
                artist: '櫻坂46',
                thumbnail_url: 'https://example.test/spotify.jpg',
                source: 'spotify_oembed',
                fetched_at: 200,
              }] };
            },
          };
        },
      };
    },
  };
  const [track] = await resolveMissingSpotifyPresentation(db, [{
    spotify_id: 'spotify-new-release',
    title: 'Jisho Ballet Dancer',
    artist: null,
    thumbnail_url: 'https://example.test/stationhead.jpg',
  }]);
  assert.equal(track.title, '自称バレエダンサー');
  assert.equal(track.artist, '櫻坂46');
  assert.equal(track.thumbnail_url, 'https://example.test/spotify.jpg');
});

test('shared Spotify repair recovers an ID carried only in the title before metadata lookup', async () => {
  const spotifyId = '6abcdefghijklmnopqrstu';
  const reads = [];
  const db = {
    prepare(sql) {
      assert.match(sql.trim(), /^SELECT spotify_id/is);
      return {
        bind(...ids) {
          reads.push(ids);
          return {
            async all() {
              return { results: [{
                spotify_id: spotifyId,
                title: 'Resolved Song',
                artist: 'Resolved Artist',
                thumbnail_url: 'https://example.test/recovered.jpg',
              }] };
            },
          };
        },
      };
    },
  };

  const [repaired] = await resolveMissingSpotifyPresentation(db, [{
    title: spotifyId,
    artist: null,
    thumbnail_url: 'https://example.test/stale.jpg',
  }]);
  assert.deepEqual(reads, [[spotifyId]]);
  assert.equal(repaired.spotify_id, spotifyId);
  assert.equal(repaired.title, 'Resolved Song');
  assert.equal(repaired.artist, 'Resolved Artist');
});

test('shared Spotify repair reads at most six ids and writes at most two new metadata rows per run', async () => {
  const originalFetch = globalThis.fetch;
  const reads = [];
  const writes = [];
  let batches = 0;
  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return { title: 'Resolved Song', author_name: 'Resolved Artist', thumbnail_url: 'https://example.test/x.jpg' };
    },
  });
  const db = {
    prepare(sql) {
      if (/^SELECT spotify_id/is.test(sql.trim())) {
        return {
          bind(...ids) {
            reads.push(ids);
            return { async all() { return { results: [] }; } };
          },
        };
      }
      if (/^INSERT INTO sh_track_metadata/is.test(sql.trim())) {
        return {
          bind(...values) {
            const statement = { values };
            writes.push(statement);
            return statement;
          },
        };
      }
      throw new Error(`unexpected SQL: ${sql}`);
    },
    async batch(statements) {
      batches += 1;
      assert.equal(statements.length, 2);
      return [];
    },
  };

  try {
    const tracks = Array.from({ length: 8 }, (_, index) => ({ spotify_id: `bounded${index}` }));
    const repaired = await resolveMissingSpotifyPresentation(db, tracks);
    assert.equal(reads.length, 1);
    assert.equal(reads[0].length, 6);
    assert.equal(writes.length, 2);
    assert.equal(batches, 1);
    assert.equal(repaired[0].title, 'Resolved Song');
    assert.equal(repaired[1].artist, 'Resolved Artist');
    assert.equal(repaired[2].title, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
