import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const pagesEntry = readFileSync(new URL('../src/ohisama-pages-entry.js', import.meta.url), 'utf8');
const playback = readFileSync(new URL('../src/ohisama-playback.js', import.meta.url), 'utf8');
const readModel = readFileSync(new URL('../src/ohisama-read-model.js', import.meta.url), 'utf8');

const SUBTAB_FIELDS = [
  'latest',
  'history_24h',
  'daily',
  'queue',
  'queue_status',
  'played_history',
  'likes',
];

test('Ohisama publishes every subtab from the single hinata materialized model', () => {
  assert.match(readModel, /OHISAMA_PAGES_MODEL_KEY = 'hinata'/);
  assert.match(pagesEntry, /refreshOptimizedOhisamaReadModel/);
  assert.match(pagesEntry, /mergeOhisamaPlaybackReadModel/);
  assert.match(playback, /pagesR2ResponseKey\('hinata'\)/);

  for (const field of SUBTAB_FIELDS) {
    assert.match(`${readModel}\n${playback}`, new RegExp(`\\b${field}\\b`), `missing read-model field ${field}`);
  }

  assert.match(playback, /queue: playback\?\.queue \|\| \[\]/);
  assert.match(playback, /played_history: mergePlayedHistory/);
  assert.match(playback, /likes: Array\.isArray\(playback\?\.likes\)/);
  assert.match(playback, /bucket\.put\(OHISAMA_PAGES_KEY/);
});

test('Ohisama subtab publication does not create separate per-tab D1 read paths', () => {
  assert.doesNotMatch(playback, /pagesR2ResponseKey\('hinata-(?:current|history|played-tracks|likes)'\)/);
  assert.doesNotMatch(pagesEntry, /track-history|dashboard-details/);
});
