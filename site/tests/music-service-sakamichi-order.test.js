import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const spotifyShell = readFileSync(new URL('../public/spotify-shell.js', import.meta.url), 'utf8');
const spotifyRuntime = readFileSync(new URL('../public/spotify.js', import.meta.url), 'utf8');
const amazonShell = readFileSync(new URL('../public/amazon-music-shell.js', import.meta.url), 'utf8');

function ordered(source, values) {
  const indexes = values.map((value) => source.indexOf(value));
  assert.ok(indexes.every((index) => index >= 0));
  assert.deepEqual(indexes, [...indexes].sort((a, b) => a - b));
}

test('music subscription Sakamichi displays use Sakurazaka, Nogizaka, Hinatazaka order', () => {
  ordered(spotifyShell, [
    "value: 'sakurazaka46'",
    "value: 'nogizaka46'",
    "value: 'hinatazaka46'",
  ]);
  assert.match(spotifyRuntime, /GRAPH_ARTIST_KEYS = Object\.freeze\(\['sakurazaka46', 'nogizaka46', 'hinatazaka46'\]\)/);
  ordered(amazonShell, [
    'data-amazon-mode="sakurazaka"',
    'data-amazon-mode="nogizaka"',
    'data-amazon-mode="hinatazaka"',
  ]);
});
