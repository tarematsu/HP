import assert from 'node:assert/strict';
import test from 'node:test';

import { REGIONAL_MUSIC_DAILY_COLLECTORS } from '../src/regional-music-entry.js';
import {
  canonicalRegionalArtist,
  REGIONAL_MUSIC_SERVICES,
  regionalMusicServicesByPhase,
} from '../src/regional-music-service-registry.js';

test('regional music registry covers all planned services and schedules every collector', () => {
  assert.equal(Object.keys(REGIONAL_MUSIC_SERVICES).length, 19);
  assert.equal(REGIONAL_MUSIC_DAILY_COLLECTORS.length, 19);
  assert.equal(new Set(REGIONAL_MUSIC_DAILY_COLLECTORS).size, 19);
  assert.deepEqual(regionalMusicServicesByPhase(1), [
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

test('Sakamichi artist aliases normalize to canonical keys', () => {
  assert.equal(canonicalRegionalArtist('櫻坂46'), 'sakurazaka46');
  assert.equal(canonicalRegionalArtist('SAKURAZAKA46'), 'sakurazaka46');
  assert.equal(canonicalRegionalArtist('日向坂46'), 'hinatazaka46');
  assert.equal(canonicalRegionalArtist('Hinatazaka46'), 'hinatazaka46');
  assert.equal(canonicalRegionalArtist('乃木坂46'), 'nogizaka46');
  assert.equal(canonicalRegionalArtist(' Nogizaka46 '), 'nogizaka46');
  assert.equal(canonicalRegionalArtist('not-the-artist'), null);
});
