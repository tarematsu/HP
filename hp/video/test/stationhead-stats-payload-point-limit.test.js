import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const webview = readFileSync(
  new URL('../../native/src/sh_webview.cpp', import.meta.url),
  'utf8',
);

test('native receiver continues to bound normalized daily points', () => {
  assert.match(webview, /chart\.Size\(\) && points\.size\(\) < 40/);
});
