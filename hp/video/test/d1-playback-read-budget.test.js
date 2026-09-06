import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const entryCoreSource = readFileSync(
  new URL('../src/entry-core.js', import.meta.url),
  'utf8'
);
const playerSource = readFileSync(
  new URL('../public/app-resilient.js', import.meta.url),
  'utf8'
);
const activePlaybackSource = readFileSync(
  new URL('../src/active-playback-feed.js', import.meta.url),
  'utf8'
);
const snapshotSource = readFileSync(
  new URL('../src/feed-snapshot.js', import.meta.url),
  'utf8'
);

test('complete playback uses all active saved videos without a 2000-video cap', () => {
  assert.match(
    entryCoreSource,
    /intParam\(url\.searchParams\.get\('limit'\), 24, 1, 100\)/
  );
  assert.match(entryCoreSource, /nextCursor: page\.nextCursor/);
  assert.match(entryCoreSource, /readAllActivePlaybackCursorPage\(env\.DB, options\)/);
  assert.doesNotMatch(entryCoreSource, /readSeededPlaybackCursorPage/);
  assert.doesNotMatch(entryCoreSource, /readOrientationPlaybackCursorPage/);
  assert.match(playerSource, /const FEED_PAGE_SIZE = 100;/);
  assert.match(playerSource, /while \(cursor\)/);
  assert.match(activePlaybackSource, /const MAX_PAGE_SIZE = 100;/);
  assert.match(activePlaybackSource, /FROM videos AS video/);
  assert.match(activePlaybackSource, /video\.status = 'active'/);
  assert.doesNotMatch(activePlaybackSource, /ranking_entries/);
  assert.doesNotMatch(activePlaybackSource, /LIMIT \?/);
  assert.doesNotMatch(activePlaybackSource, /OFFSET/);
  assert.match(snapshotSource, /FROM videos AS video/);
  assert.match(snapshotSource, /video\.status = 'active'/);
  assert.doesNotMatch(snapshotSource, /ranking_entries/);
  assert.doesNotMatch(snapshotSource, /PLAYBACK_FEED_LIMIT/);
  assert.doesNotMatch(snapshotSource, /LIMIT \?/);
});
