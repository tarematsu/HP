import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/nogizaka-raw-materializer.js', import.meta.url), 'utf8');

test('Nogizaka reuses the shared bounded Spotify presentation resolver only for active queues', () => {
  assert.match(source, /resolveMissingSpotifyPresentation/);
  assert.match(source, /if \(active && queue\?\.tracks\?\.length && env\?\.MINUTE_DB\?\.prepare\)/);
  assert.match(source, /resolveMissingSpotifyPresentation\(env\.MINUTE_DB, queue\.tracks/);
});
