import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canonicalRegionalArtist,
  REGIONAL_MUSIC_SERVICES,
  regionalMusicServicesByPhase,
} from '../src/regional-music-service-registry.js';

test('regional music registry covers all planned services', () => {
  assert.equal(Object.keys(REGIONAL_MUSIC_SERVICES).length, 19);
  assert.deepEqual(regionalMusicServicesByPhase(1), [
    'genie',
    'bugs',
    'joox',
    'nhaccuatui',
    'anghami',
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
