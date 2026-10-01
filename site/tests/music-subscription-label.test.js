import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

test('top-level subscription navigation is labeled 音楽サブスク', () => {
  assert.match(page, /data-section="subscriptions"[^>]*>音楽サブスク<\/button>/);
  assert.doesNotMatch(page, /data-section="subscriptions"[^>]*>サブスク<\/button>/);
});
