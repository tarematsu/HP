import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildWeightedPlaybackPage,
  freshnessWeight,
  weightedPlaybackKey
} from '../src/weighted-playback.js';

const NOW = Date.parse('2026-09-06T12:00:00Z');

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
  assert.equal(freshnessWeight('', NOW), 1);
});

test('five-times freshness weight wins about five out of six pairwise draws', () => {
  let newerWins = 0;
  let olderWins = 0;
  for (let seed = 1; seed <= 10_000; seed += 1) {
    const newer = weightedPlaybackKey(1, daysAgo(1), seed, NOW);
    const older = weightedPlaybackKey(2, daysAgo(365), seed, NOW);
    if (newer < older) newerWins += 1;
    else olderWins += 1;
  }
  assert.ok(newerWins > 8_000, `expected strong new-video bias, got ${newerWins}`);
  assert.ok(olderWins > 1_000, `expected old videos to remain selectable, got ${olderWins}`);
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
