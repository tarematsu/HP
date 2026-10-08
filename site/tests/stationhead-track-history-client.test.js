import assert from 'node:assert/strict';
import test from 'node:test';
import { createStationheadTrackHistoryClient } from '../public/stationhead/track-history-client.js';

for (const [source, artist, prefix] of [
  ['buddies', '櫻坂46', '/api/track-history?'],
  ['ohisama', '日向坂46', '/api/track-history?source=ohisama&'],
]) {
  test(`${source}: shared track-history client preserves request paths and normalized results`, async () => {
    const calls = [];
    const options = { force: true, signal: { id: 'signal' } };
    const client = createStationheadTrackHistoryClient(source, artist, async (url, requestOptions) => {
      calls.push([url, requestOptions]);
      if (url.includes('dates_only=1')) return { dates: ['2026-10-02', 'invalid', '2026-10-01'] };
      if (url.includes('ranking_only=1')) return { ranking: [
        { title: 'same', artist, like_count: 10 },
        { title: 'unknown', artist: '', like_count: 5 },
        { title: 'other', artist: 'OtherArtist', like_count: 20 },
      ] };
      return { rows: [{ track_id: 7, title: 'example', artist, play_count: 3 }] };
    });
    assert.deepEqual(await client.loadIndex(options), ['2026-10-01', '2026-10-02']);
    assert.deepEqual(await client.loadPeriod('2026-10-01', '2026-10-02', options),
      [{ track_id: 7, spotify_id: null, isrc: null, title: 'example', artist, thumbnail_url: null, play_count: 3 }]);
    assert.deepEqual((await client.loadLikes(options)).map((row) => row.title), ['same', 'unknown']);
    assert.deepEqual(calls.map(([url]) => url), [
      prefix + 'dates_only=1',
      prefix + 'from=2026-10-01&to=2026-10-02&limit=10000&ranking=0',
      prefix + 'ranking_only=1&ranking_limit=500',
    ]);
    assert.ok(calls.every(([, requestOptions]) => requestOptions === options));
  });
}

test('track-history requests do not turn failures into empty successes', async () => {
  const expected = new Error('temporary upstream outage');
  const client = createStationheadTrackHistoryClient('ohisama', '日向坂46', async () => { throw expected; });
  await assert.rejects(client.loadIndex(), (error) => error === expected);
  await assert.rejects(client.loadLikes(), (error) => error === expected);
  assert.throws(() => createStationheadTrackHistoryClient('unknown', '', () => {}), /Unsupported/);
});
