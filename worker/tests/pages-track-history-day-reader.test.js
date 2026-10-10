import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { loadTrackHistoryDayReadModel, trackHistoryDayObjectKey } from '../src/pages-track-history-day-reader.js';

test('HTTP day reader preserves source keys and fails closed on missing or invalid days', async () => {
  assert.equal(trackHistoryDayObjectKey('2026-10-10'), 'track-history-days/v1/2026-10-10.json');
  assert.equal(trackHistoryDayObjectKey('2026-10-10', 'ohisama'), 'track-history-days/v1/ohisama/2026-10-10.json');
  assert.throws(() => trackHistoryDayObjectKey('2026-10-10', 'unknown'));
  assert.throws(() => trackHistoryDayObjectKey('invalid'));
  assert.equal(await loadTrackHistoryDayReadModel({ get: async () => null }, '2026-10-10'), null);
  const payload = { version: 1, day: '2026-10-10', rows: [{ play_count: 2 }] };
  const model = await loadTrackHistoryDayReadModel({ get: async () => ({ text: async () => JSON.stringify(payload) }) }, payload.day);
  assert.deepEqual(model.payload, payload);
  await assert.rejects(loadTrackHistoryDayReadModel({ get: async () => ({ json: async () => ({ ...payload, day: '2026-10-09' }) }) }, payload.day));
});

test('history HTTP import graph excludes the publication and SQL reconstruction pipeline', () => {
  const visited = new Set();
  const walk = url => {
    if (visited.has(url.href)) return;
    visited.add(url.href);
    const source = readFileSync(url, 'utf8');
    for (const match of source.matchAll(/(?:from\s+|import\s*)['"](\.[^'"]+)['"]/g)) walk(new URL(match[1], url));
  };
  walk(new URL('../src/pages-track-history-r2-api.js', import.meta.url));
  for (const url of visited) {
    assert.doesNotMatch(url, /pages-track-history-r2-shards|track-history-restored-handler|canonical-track-rows|track-history-merge/);
  }
});
