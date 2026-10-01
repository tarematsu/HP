import assert from 'node:assert/strict';
import test from 'node:test';
import { hydratePlaybackAggregates, hydratePlaybackTrackMetadata } from '../src/playback-track-metadata.js';

const canonical = { track_id: 898, title: 'タイトル', artist: '櫻坂46', thumbnail_url: 'https://example.test/art.jpg', spotify_id: 'spotify898' };

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
  assert.equal(db.queries.length, 1);
  assert.deepEqual(db.queries[0].ids, [898]);
});

test('complete cached metadata satisfies an unchanged queue without database reads', async () => {
  const db = catalog();
  const [track] = await hydratePlaybackTrackMetadata(db, [{ track_id: 898, position: 1 }], [canonical]);
  assert.equal(track.title, canonical.title);
  assert.equal(track.position, 1);
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
