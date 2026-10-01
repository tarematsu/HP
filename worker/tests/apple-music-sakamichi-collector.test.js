import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { APPLE_MUSIC_ARTISTS } from '../src/apple-music-sakamichi-collector.js';

test('Apple Music collection targets the three Sakamichi groups in display order', () => {
  assert.deepEqual(
    APPLE_MUSIC_ARTISTS.map(({ key, id, name }) => ({ key, id, name })),
    [
      { key: 'sakurazaka46', id: '1541126420', name: '櫻坂46' },
      { key: 'nogizaka46', id: '571990937', name: '乃木坂46' },
      { key: 'hinatazaka46', id: '1456116642', name: '日向坂46' },
    ],
  );
});

test('Apple Music scheduled worker runs the secondary collector and persists secondary-only changes', () => {
  const source = readFileSync(new URL('../src/amazon-music-entry.js', import.meta.url), 'utf8');
  assert.match(source, /collectAdditionalAppleMusicArtists/);
  assert.match(source, /primaryResult: result/);
  assert.match(source, /sakamichi\?\.changed/);
  assert.match(source, /persistAppleMusicModelToOther\(env, scheduledTime\)/);
});

test('Apple Music Pages exposes group switching for all three artists', () => {
  const shell = readFileSync(new URL('../../site/public/apple-music-shell.js', import.meta.url), 'utf8');
  const view = readFileSync(new URL('../../site/public/apple-music.js', import.meta.url), 'utf8');
  assert.match(shell, /value: 'sakurazaka46', label: '櫻坂46', active: true/);
  assert.match(shell, /value: 'nogizaka46', label: '乃木坂46'/);
  assert.match(shell, /value: 'hinatazaka46', label: '日向坂46'/);
  assert.match(view, /payload\?\.artists/);
  assert.match(view, /data-apple-artist/);
});
