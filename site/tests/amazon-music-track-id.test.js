import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const runtime = readFileSync(new URL('../public/amazon-music.js', import.meta.url), 'utf8');

test('Amazon Music UI uses sh_tracks.id before Amazon Music ID for track identity', () => {
  assert.match(runtime, /function trackKey\(track\)/);
  assert.match(runtime, /integer\(track\?\.track_id\)/);
  assert.match(runtime, /return `track:\$\{trackId\}`/);
  assert.match(runtime, /return amazonId \? `amazon:\$\{amazonId\}` : ''/);
  assert.match(runtime, /const id = trackKey\(track\)/);
  assert.doesNotMatch(runtime, /const id = String\(track\?\.amazon_music_id \|\| ''\);/);
});
