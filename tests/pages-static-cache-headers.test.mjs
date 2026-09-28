import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const headers = readFileSync(new URL('../site/public/_headers', import.meta.url), 'utf8');

function blockFor(pattern) {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = headers.match(new RegExp(`(?:^|\\n)${escaped}\\n((?:[ \\t]+[^\\n]+\\n?)*)`, 'm'));
  return match?.[1] || '';
}

test('global Pages headers do not disable static asset caching', () => {
  const globalBlock = blockFor('/*');
  assert.match(globalBlock, /X-Robots-Tag:/);
  assert.doesNotMatch(globalBlock, /Cache-Control:/i);
});

test('HTML entry points remain no-store', () => {
  for (const path of ['/', '/index.html', '/sakurazaka46jp', '/sakurazaka46jp/', '/sakurazaka46jp/index.html']) {
    assert.match(blockFor(path), /Cache-Control:\s*no-store, max-age=0, must-revalidate/i, path);
  }
});

test('versioned JavaScript and CSS stay immutable in the browser cache', () => {
  for (const pattern of ['/*.js', '/*.css']) {
    const block = blockFor(pattern);
    assert.match(block, /Cache-Control:\s*public, max-age=31536000, immutable/i, pattern);
    assert.doesNotMatch(block, /must-revalidate/i, pattern);
  }
});
