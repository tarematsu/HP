import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const runtime = readFileSync(new URL('../public/amazon-music.js', import.meta.url), 'utf8');

test('Amazon Music UI keeps source editions separate before canonical sh_tracks.id fallback', () => {
  assert.match(runtime, /function trackKey\(track\)/);
  assert.match(runtime, /const amazonId = String\(track\?\.amazon_music_id \|\| ''\)\.trim\(\)/);
  assert.match(runtime, /if \(amazonId\) return `amazon:\$\{amazonId\}`/);
  assert.match(runtime, /integer\(track\?\.track_id\)/);
  assert.match(runtime, /return trackId != null && trackId > 0 \? `track:\$\{trackId\}` : ''/);
  assert.match(runtime, /const id = trackKey\(track\)/);
});
