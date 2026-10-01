import assert from 'node:assert/strict';
import test from 'node:test';

import {
  REGIONAL_MUSIC_COLLECTOR_CONCURRENCY,
  REGIONAL_MUSIC_DAILY_COLLECTORS,
  REGIONAL_MUSIC_DAILY_CRON,
  REGIONAL_MUSIC_SERVICE_COLLECTORS,
  YOUTUBE_MUSIC_DAILY_COLLECTORS,
  YOUTUBE_MUSIC_DAILY_CRON,
  collectRegionalServicesDaily,
  collectYouTubeMusicDaily,
  runRegionalMusicCollectors,
  scheduledCollectorForCron,
} from '../src/regional-music-entry.js';
import {
  canonicalRegionalArtist,
  REGIONAL_MUSIC_ARTISTS,
  REGIONAL_MUSIC_SERVICES,
  YOUTUBE_MUSIC_ARTISTS,
  regionalMusicServicesByPhase,
} from '../src/regional-music-service-registry.js';

test('regional music registry covers all planned services and keeps the 19 regional collectors explicit', () => {
  assert.equal(Object.keys(REGIONAL_MUSIC_SERVICES).length, 20);
  assert.equal(REGIONAL_MUSIC_SERVICE_COLLECTORS.length, 19);
  assert.equal(new Set(REGIONAL_MUSIC_SERVICE_COLLECTORS).size, 19);
  assert.equal(YOUTUBE_MUSIC_DAILY_COLLECTORS.length, 1);
  assert.equal(REGIONAL_MUSIC_DAILY_COLLECTORS.length, 20);
  assert.equal(new Set(REGIONAL_MUSIC_DAILY_COLLECTORS).size, 20);
  assert.equal(
    REGIONAL_MUSIC_DAILY_COLLECTORS.filter((collector) => !REGIONAL_MUSIC_SERVICE_COLLECTORS.includes(collector)).length,
    1,
  );
  assert.deepEqual(regionalMusicServicesByPhase(1), [
    'youtube_music',
    'genie',
    'bugs',
    'joox',
    'nhaccuatui',
    'anghami',
  ]);
  assert.deepEqual(regionalMusicServicesByPhase(2), [
    'qq_music',
    'netease_cloud_music',
    'kugou_music',
    'melon',
    'naver_vibe',
    'flo',
  ]);
  assert.deepEqual(regionalMusicServicesByPhase(3), [
    'yandex_music',
    'boomplay',
    'plern',
    'fungjai',
    'zing_mp3',
    'jiosaavn',
    'gaana',
    'langit_musik',
  ]);
});

test('YouTube Music alone targets Aobazaka46 in addition to the three existing groups', () => {
  assert.deepEqual(Object.keys(REGIONAL_MUSIC_ARTISTS), [
    'sakurazaka46',
    'hinatazaka46',
    'nogizaka46',
  ]);
  assert.deepEqual(Object.keys(YOUTUBE_MUSIC_ARTISTS), [
    'sakurazaka46',
    'hinatazaka46',
    'nogizaka46',
    'aobazaka46',
  ]);
  assert.equal(YOUTUBE_MUSIC_ARTISTS.aobazaka46.displayName, '青葉坂46');
  assert.equal(Object.hasOwn(REGIONAL_MUSIC_ARTISTS, 'aobazaka46'), false);
});

test('scheduled regional collection splits YouTube Music at midnight JST from regional services at 06:00 JST', () => {
  assert.equal(YOUTUBE_MUSIC_DAILY_CRON, '0 15 * * *');
  assert.equal(REGIONAL_MUSIC_DAILY_CRON, '0 21 * * *');
  assert.equal(scheduledCollectorForCron(YOUTUBE_MUSIC_DAILY_CRON), collectYouTubeMusicDaily);
  assert.equal(scheduledCollectorForCron(REGIONAL_MUSIC_DAILY_CRON), collectRegionalServicesDaily);
});

test('regional music runner bounds concurrency and preserves collector order', async () => {
  let active = 0;
  let maximumActive = 0;
  const collectors = Array.from({ length: 9 }, (_, index) => async function collector() {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return { service: `service-${index}`, status: 'ok' };
  });

  const results = await runRegionalMusicCollectors(collectors, {}, Date.now(), () => {}, 3);
  assert.equal(maximumActive, 3);
  assert.deepEqual(results.map((result) => result.service), collectors.map((_, index) => `service-${index}`));
  assert.equal(REGIONAL_MUSIC_COLLECTOR_CONCURRENCY, 4);
});

test('regional music runner isolates a provider failure', async () => {
  async function first() { return { service: 'first', status: 'ok' }; }
  async function broken() { throw new Error('provider unavailable'); }
  async function third() { return { service: 'third', status: 'ok' }; }

  const results = await runRegionalMusicCollectors([first, broken, third], {}, Date.now(), () => {}, 2);
  assert.equal(results[0].status, 'ok');
  assert.deepEqual(results[1], {
    service: 'broken',
    status: 'error',
    error: 'provider unavailable',
  });
  assert.equal(results[2].status, 'ok');
});

test('Sakamichi artist aliases normalize to canonical keys', () => {
  assert.equal(canonicalRegionalArtist('櫻坂46'), 'sakurazaka46');
  assert.equal(canonicalRegionalArtist('SAKURAZAKA46'), 'sakurazaka46');
  assert.equal(canonicalRegionalArtist('日向坂46'), 'hinatazaka46');
  assert.equal(canonicalRegionalArtist('Hinatazaka46'), 'hinatazaka46');
  assert.equal(canonicalRegionalArtist('乃木坂46'), 'nogizaka46');
  assert.equal(canonicalRegionalArtist(' Nogizaka46 '), 'nogizaka46');
  assert.equal(canonicalRegionalArtist('青葉坂46'), null);
  assert.equal(canonicalRegionalArtist('not-the-artist'), null);
});
