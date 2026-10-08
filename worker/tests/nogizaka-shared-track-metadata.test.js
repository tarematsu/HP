import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/nogizaka-raw-materializer.js', import.meta.url), 'utf8');

test('Nogizaka uses the canonical Stationhead identity and metadata pipeline for active queues', () => {
  assert.match(source, /canonicalizeStationheadQueueTracks/);
  assert.match(source, /if \(active && queue\?\.tracks\?\.length && env\?\.MINUTE_DB\?\.prepare\)/);
  assert.doesNotMatch(source, /resolveMissingSpotifyPresentation/);
});
