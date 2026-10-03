import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

test('top-level subscription navigation is labeled 音楽ストリーミングサービス', () => {
  assert.match(page, /data-section="subscriptions"[^>]*>音楽ストリーミングサービス<\/button>/);
  assert.doesNotMatch(page, /音楽サブスク/);
});
