import assert from 'node:assert/strict';
import test from 'node:test';
import { encodePlaybackCursor, parsePlaybackCursor } from '../src/playback-cursor.js';

import {
  buildWeightedPlaybackPage,
  freshnessWeight,
  weightedPlaybackKey
} from '../src/weighted-playback.js';

const NOW = Date.parse('2026-09-06T12:00:00Z');

test('bounded selection matches full sorting across large feeds and cursor pages', () => {
  const rows = Array.from({ length: 10000 }, (_, index) => ({
    id: String(index + 1), firstSeenAt: daysAgo(index % 400), marker: index
  }));
  for (const seed of [1, 77, 1731811407]) {
    let cursor = 'start';
    for (let page = 0; page < 4; page += 1) {
      const parsed = parsePlaybackCursor(cursor);
      const ordered = rows.map(row => ({ ...row, id: Number(row.id),
        shuffleKey: weightedPlaybackKey(row.id, row.firstSeenAt, seed, NOW)
      })).sort((a, b) => a.shuffleKey - b.shuffleKey || a.id - b.id)
        .filter(row => !parsed || row.shuffleKey > parsed.shuffleKey
          || (row.shuffleKey === parsed.shuffleKey && row.id > parsed.videoId));
      const expectedRows = ordered.slice(0, 100);
      const expected = { rows: expectedRows,
        nextCursor: ordered.length > 100 ? encodePlaybackCursor(0, expectedRows.at(-1)) : null };
      const actual = buildWeightedPlaybackPage(rows, { seed, cursor, limit: 100, nowMs: NOW });
      assert.deepEqual(actual, expected);
      cursor = actual.nextCursor;
    }
  }
  assert.deepEqual(buildWeightedPlaybackPage(rows.slice(0, 2), {
    seed: 77, limit: 100, nowMs: NOW
  }).nextCursor, null);
});

function daysAgo(days) {
  return new Date(NOW - days * 24 * 60 * 60 * 1000).toISOString();
}

test('freshness buckets give newer videos stronger weights', () => {
  assert.equal(freshnessWeight(daysAgo(1), NOW), 5);
  assert.equal(freshnessWeight(daysAgo(7), NOW), 5);
  assert.equal(freshnessWeight(daysAgo(8), NOW), 3);
  assert.equal(freshnessWeight(daysAgo(30), NOW), 3);
  assert.equal(freshnessWeight(daysAgo(31), NOW), 2);
  assert.equal(freshnessWeight(daysAgo(90), NOW), 2);
  assert.equal(freshnessWeight(daysAgo(91), NOW), 1);
  assert.equal(freshnessWeight(daysAgo(180), NOW), 1);
  assert.equal(freshnessWeight(daysAgo(181), NOW), 0.5);
  assert.equal(freshnessWeight(daysAgo(365), NOW), 0.5);
  assert.equal(freshnessWeight('', NOW), 1);
});

test('five-times freshness weight strongly favors new videos while old videos remain selectable', () => {
  let newerWins = 0;
  let olderWins = 0;
  for (let seed = 1; seed <= 10_000; seed += 1) {
    const newer = weightedPlaybackKey(1, daysAgo(1), seed, NOW);
    const older = weightedPlaybackKey(2, daysAgo(365), seed, NOW);
    if (newer < older) newerWins += 1;
    else olderWins += 1;
  }
  assert.ok(newerWins > 8_800, `expected strong new-video bias, got ${newerWins}`);
  assert.ok(olderWins > 500, `expected old videos to remain selectable, got ${olderWins}`);
});

test('weighted paging is deterministic for a seed and has no duplicates', () => {
  const rows = Array.from({ length: 40 }, (_, index) => ({
    id: index + 1,
    mediaUrl: `https://example.com/${index + 1}.mp4`,
    firstSeenAt: daysAgo(index * 4)
  }));
  const first = buildWeightedPlaybackPage(rows, {
    seed: 77,
    cursor: 'start',
    limit: 13,
    nowMs: NOW
  });
  const repeated = buildWeightedPlaybackPage(rows, {
    seed: 77,
    cursor: 'start',
    limit: 13,
    nowMs: NOW
  });
  assert.deepEqual(first, repeated);
  assert.ok(first.nextCursor);

  const second = buildWeightedPlaybackPage(rows, {
    seed: 77,
    cursor: first.nextCursor,
    limit: 13,
    nowMs: NOW
  });
  const firstIds = new Set(first.rows.map((row) => row.id));
  assert.ok(second.rows.every((row) => !firstIds.has(row.id)));
});
