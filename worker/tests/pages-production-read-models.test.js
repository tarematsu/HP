import assert from 'node:assert/strict';
import test from 'node:test';
import { saveMaterializedR2Response } from '../src/pages-response-r2.js';
import { runPagesResponseFetch } from '../src/pages-response-fetch-entry.js';
import { publishStationheadLikesReadModel } from '../src/stationhead-likes-read-model.js';
import { publishStationheadPlaybackDay } from '../src/stationhead-playback-publication.js';
import { proxyStationheadMaterializedReadModel } from '../../site/functions/lib/stationhead-materialized-proxy.js';
import { musicServiceReadModelResponse } from '../../site/functions/lib/music-service-read-model.js';
import { buildNogizakaListeningPartyReadModel } from '../src/nogizaka-pages-read-model.js';

function bucket() {
  const objects = new Map();
  return {
    async put(key, body, options = {}) { objects.set(key, { body, options }); },
    async get(key) {
      const stored = objects.get(key);
      if (!stored) return null;
      return { body: new Response(stored.body).body, customMetadata: stored.options.customMetadata,
        json: async () => JSON.parse(stored.body), text: async () => stored.body };
    },
  };
}
function serviceEnv(r2, now) {
  return { PAGES_READ_MODEL_SERVICE: { fetch: (request) => runPagesResponseFetch(request,
    { PAGES_RESPONSE_R2: r2 }, { now: () => now }) } };
}

test('Ohisama current is accessible through the real producer-to-Pages R2 contract', async () => {
  const r2 = bucket();
  await saveMaterializedR2Response(r2, 'hinata', JSON.stringify({ ok: true, latest: { online_member_count: 123 } }), 200, {}, 1000, 300);
  const response = await proxyStationheadMaterializedReadModel(serviceEnv(r2, 1000), 'ohisama');
  assert.equal(response.status, 200);
  assert.equal((await response.json()).latest.online_member_count, 123);
});
for (const service of ['youtube_music', 'kkbox', 'qq_music', 'kugou_music']) {
  test(`${service} canonical model passes through the real public proxy`, async () => {
    const r2 = bucket();
    await saveMaterializedR2Response(r2, `music-service:${service}`, JSON.stringify({ ok: true, service, tracks: [] }), 200, {}, 1000, 86400);
    const response = await musicServiceReadModelResponse(serviceEnv(r2, 1000), service);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).service, service);
  });
}
for (const source of ['buddies', 'ohisama']) {
  test(`${source} shares ingestion publication and public likes/playback reads`, async () => {
    const r2 = bucket();
    await publishStationheadLikesReadModel(r2, source, [{ track_id: 46, title: 'Song', like_count: 123, observed_at: 1000 }], 1000);
    await publishStationheadPlaybackDay(r2, source, { period_key: '2026-10-08', total_plays: 3,
      tracks: [{ track_id: 46, title: 'Song', count: 3 }] }, 1000);
    const env = { PAGES_RESPONSE_R2: r2 };
    const read = (params) => runPagesResponseFetch(new Request(`https://internal/_internal/pages-response?key=track-history&api=1&source=${source}&${params}`), env, { now: () => 1000 });
    const likes = await read('ranking_only=1');
    assert.equal(likes.status, 200);
    assert.equal((await likes.json()).ranking[0].like_count, 123);
    const plays = await read('ranking=0&from=2026-10-08&to=2026-10-08');
    assert.equal(plays.status, 200);
    assert.equal((await plays.json()).rows[0].play_count, 3);
  });
}
test('Nogizaka history requires a valid official announcement rather than orphan test summaries', async () => {
  let historySql;
  const payload = await buildNogizakaListeningPartyReadModel({ OTHER_DB: {
    prepare(sql) { return { bind() { return this; }, async first() { return null; }, async all() { historySql = sql; return { results: [] }; } }; },
  } }, Date.parse('2026-10-08T11:00:00Z'));
  assert.match(historySql, /INNER JOIN latest_sources/);
  assert.match(historySql, /INNER JOIN sh_nogizaka_official_news_announcements/);
  assert.deepEqual(payload.rows, []);
});

test('playback publication never replaces the date index after a transient read failure', async () => {
  let writes = [];
  const r2 = { async put(key) { writes.push(key); }, async get() { throw new Error('temporary R2 failure'); } };
  await assert.rejects(publishStationheadPlaybackDay(r2, 'buddies', { period_key: '2026-10-08', total_plays: 1,
    tracks: [{ track_id: 46, count: 1 }] }, 1000), /temporary R2 failure/);
  assert.equal(writes.some((key) => key.endsWith('/index.json')), false);
});

test('Buddies collector capture publishes current likes and playback without a history rebuild', async () => {
  const { captureBuddiesPlayback } = await import('../src/buddies-playback-state.js');
  const r2 = bucket();
  const now = Date.parse('2026-10-08T11:00:00Z');
  const statements = [];
  const db = { prepare(sql) { statements.push(sql); return { bind() { return this; }, async all() { return { results: [] }; }, async run() {} }; }, async batch() {} };
  const result = await captureBuddiesPlayback({ DB: db, MINUTE_DB: db, PAGES_RESPONSE_R2: r2 }, {
    station_id: 1, queue_id: 1, start_time: now - 1000,
    tracks: [{ track_id: 46, position: 0, expected_start_at: now - 1000, title: 'Song', artist: '櫻坂46',
      spotify_id: 'spotify-song', track_key: 'spotify:spotify-song', presentation_version: 1,
      thumbnail_url: 'https://example.test/art.jpg', duration_ms: 240000, bite_count: 123 }],
  }, now);
  assert.equal(result.state_saved, true);
  const likes = await runPagesResponseFetch(new Request('https://internal/_internal/pages-response?key=track-history&api=1&ranking_only=1'), { PAGES_RESPONSE_R2: r2 }, { now: () => now });
  assert.equal(likes.status, 200);
  assert.equal((await likes.json()).ranking[0].like_count, 123);
  const played = await runPagesResponseFetch(new Request('https://internal/_internal/pages-response?key=track-history&api=1&ranking=0&from=2026-10-08&to=2026-10-08'), { PAGES_RESPONSE_R2: r2 }, { now: () => now });
  assert.equal(played.status, 200);
  assert.equal((await played.json()).rows[0].play_count, 1);
  assert.ok(statements.some((sql) => sql.includes('INSERT OR IGNORE INTO sh_track_plays')));
});

test('Buddies source-scoped likes retain migration counters for tracks absent from the new hot state', async () => {
  const r2 = bucket();
  await saveMaterializedR2Response(r2, 'track-history-status', JSON.stringify({ ok: true, ranking: [
    { track_id: 1, title: 'Older song', latest_like_count: 200, latest_observed_at: 500 },
    { track_id: 2, title: 'Current song', latest_like_count: 100, latest_observed_at: 500 },
  ] }), 200, {}, 500, 300);
  const result = await publishStationheadLikesReadModel(r2, 'buddies', [
    { track_id: 2, title: 'Current song', like_count: 101, observed_at: 1000 },
  ], 1000);
  assert.deepEqual(result.payload.ranking.map(({ track_id, like_count }) => [track_id, like_count]), [[1, 200], [2, 101]]);
});
